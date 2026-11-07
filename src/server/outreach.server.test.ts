import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

process.env["TURSO_DATABASE_URL"] = "file::memory:";
delete process.env["TURSO_AUTH_TOKEN"];
process.env["GMAIL_USER"] = "sender@example.test";
process.env["GMAIL_APP_PASSWORD"] = "test-app-password";

const { closeDatabase, db } = await import("./database");
const { sendArticleSubmissionEmail, sendOutreachEmail } = await import("./outreach.server");
const { campaigns, outreach_logs, prospects, users } = await import("../../drizzle/schema");

describe("article draft email workflow", () => {
  let userId = "";
  let campaignId = "";

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "outreach-test@example.test",
        password_hash: "test-scrypt-hash",
        full_name: "Outreach Test",
      })
      .returning()
      .all();
    if (!user) throw new Error("Outreach test user was not created.");
    userId = user.id;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        user_id: userId,
        name: "Outreach test",
        target_url: "https://example.test/",
        target_anchor: "example",
        niche: "Testing",
      })
      .returning()
      .all();
    if (!campaign) throw new Error("Outreach test campaign was not created.");
    campaignId = campaign.id;
  });

  beforeEach(() => {
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: `message-${randomUUID()}` });
  });

  afterAll(() => {
    closeDatabase();
  });

  it("does not mark an article draft as an editor reply", async () => {
    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: `pitched-${randomUUID()}.example.test`,
        contact_email: "editor@example.test",
        status: "Pitched",
        workflow_status: "Email Outreach",
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Outreach test prospect was not created.");

    await sendArticleSubmissionEmail(userId, campaignId, prospect.id, "Draft title", "Draft body");

    const savedProspect = await db
      .select()
      .from(prospects)
      .where(eq(prospects.id, prospect.id))
      .get();
    expect(savedProspect?.status).toBe("Pitched");
    expect(savedProspect?.workflow_status).toBe("Email Outreach");
    expect(
      await db.select().from(outreach_logs).where(eq(outreach_logs.prospect_id, prospect.id)).all(),
    ).toHaveLength(1);
    const sentMessage = sendMailMock.mock.calls[0]?.[0] as { text: string; html: string };
    expect(sentMessage.text).toContain("publish the article");
    expect(sentMessage.text).toContain("permission for us to submit it");
    expect(sentMessage.html).toContain("permission for us to submit it");
  });

  it("includes the publication-or-permission request in outreach pitches", async () => {
    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: `pitch-${randomUUID()}.example.test`,
        contact_email: "editor@example.test",
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Outreach test prospect was not created.");

    await sendOutreachEmail(
      userId,
      campaignId,
      prospect.id,
      "Guest contribution",
      "Hello Editor,\n\nWe have an article idea for your publication.",
    );

    const sentMessage = sendMailMock.mock.calls[0]?.[0] as { text: string };
    expect(sentMessage.text).toContain("publish the article");
    expect(sentMessage.text).toContain("permission for us to submit it");
    const savedLog = await db
      .select()
      .from(outreach_logs)
      .where(eq(outreach_logs.prospect_id, prospect.id))
      .get();
    expect(savedLog?.body).toContain("permission for us to submit it");
  });

  it("preserves an existing replied status when sending the requested draft", async () => {
    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: `replied-${randomUUID()}.example.test`,
        contact_email: "editor@example.test",
        status: "Replied",
        workflow_status: "Email Outreach",
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Outreach test prospect was not created.");

    await sendArticleSubmissionEmail(userId, campaignId, prospect.id, "Draft title", "Draft body");

    const savedProspect = await db
      .select()
      .from(prospects)
      .where(eq(prospects.id, prospect.id))
      .get();
    expect(savedProspect?.status).toBe("Replied");
  });

  it("skips duplicate autonomous article dispatches for the same prospect", async () => {
    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: `duplicate-${randomUUID()}.example.test`,
        contact_email: "editor@example.test",
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Outreach test prospect was not created.");

    await sendArticleSubmissionEmail(userId, campaignId, prospect.id, "Same article", "Body", true);
    const second = await sendArticleSubmissionEmail(
      userId,
      campaignId,
      prospect.id,
      "Same article",
      "Body",
      true,
    );

    expect(second).toMatchObject({ sent: false, duplicate: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

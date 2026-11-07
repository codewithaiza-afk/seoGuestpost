import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const testDirectory = join(process.cwd(), ".test-data", `linkforge-gmail-${randomUUID()}`);
mkdirSync(testDirectory, { recursive: true });
process.env["DATABASE_PATH"] = join(testDirectory, "guest-posting.sqlite");
process.env["DATABASE_BACKUP_DIR"] = join(testDirectory, "backups");
process.env["TURSO_DATABASE_URL"] = "file::memory:";
process.env["GOOGLE_OAUTH_CLIENT_ID"] = "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-client-secret";
process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"] = "test-encryption-key-with-at-least-32-characters";
process.env["APP_BASE_URL"] = "http://localhost:3000";

const { closeDatabase, db } = await import("./database");
const {
  campaigns,
  gmail_connections,
  gmail_oauth_states,
  inbound_email_replies,
  outreach_logs,
  prospects,
  users,
} = await import("../../drizzle/schema");
const {
  classifyEditorReply,
  createGmailAuthorizationUrl,
  finishGmailAuthorization,
  syncAllGmailReplies,
  syncCampaignReplies,
} = await import("./gmail.server");

describe("Gmail reply workflow", () => {
  let userId = "";
  let campaignId = "";
  let prospectId = "";

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "gmail-test@example.test",
        password_hash: "test-scrypt-hash",
        full_name: "Gmail Test",
      })
      .returning()
      .all();
    if (!user) throw new Error("Gmail test user was not created.");
    userId = user.id;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        user_id: userId,
        name: "Gmail reply test",
        target_url: "https://example.test/",
        target_anchor: "example",
        niche: "Testing",
      })
      .returning()
      .all();
    if (!campaign) throw new Error("Gmail test campaign was not created.");
    campaignId = campaign.id;

    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: "publisher.example.test",
        contact_email: "editor@publisher.example.test",
        status: "Pitched",
        workflow_status: "Email Outreach",
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Gmail test prospect was not created.");
    prospectId = prospect.id;
    await db
      .insert(outreach_logs)
      .values({
        prospect_id: prospectId,
        subject: "Guest post idea",
        body: "Test outreach",
        sent_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .run();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    closeDatabase();
    if (existsSync(testDirectory)) rmSync(testDirectory, { recursive: true, force: true });
  });

  it("classifies common editor acceptances and declines", () => {
    expect(classifyEditorReply("Re: Guest post", "We are happy to publish this.")).toBe("positive");
    expect(classifyEditorReply("Re: Guest post", "We are not accepting guest posts.")).toBe(
      "negative",
    );
    expect(classifyEditorReply("Re: Guest post", "Thanks for the note. We will review it.")).toBe(
      "neutral",
    );
  });

  it("skips scheduled scans for accounts without a connected inbox", async () => {
    await expect(syncAllGmailReplies()).resolves.toEqual({
      campaignsChecked: 0,
      campaignsFailed: 0,
      newReplies: 0,
    });
  });

  it("uses one-time OAuth state with PKCE and a campaign-safe return path", async () => {
    const authUrl = new URL(await createGmailAuthorizationUrl(userId, `/campaigns/${campaignId}`));
    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("scope")).toContain("gmail.readonly");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("state")).toHaveLength(43);

    const state = authUrl.searchParams.get("state");
    if (!state) throw new Error("OAuth state was not generated.");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const stateRow = await db
      .select()
      .from(gmail_oauth_states)
      .where(eq(gmail_oauth_states.state_hash, stateHash))
      .get();
    expect(stateRow?.return_path).toBe(`/campaigns/${campaignId}`);
    expect(stateRow?.state_hash).not.toContain(state);
  });

  it("matches an editor reply, advances workflow without publishing, and deduplicates messages", async () => {
    const authUrl = new URL(await createGmailAuthorizationUrl(userId, `/campaigns/${campaignId}`));
    const state = authUrl.searchParams.get("state");
    if (!state) throw new Error("OAuth state was not generated.");

    const sentAt = Date.now();
    const gmailMessage = {
      id: "gmail-reply-test-1",
      internalDate: String(sentAt),
      snippet: "We are happy to publish the article.",
      payload: {
        headers: [
          { name: "From", value: "Editor <editor@publisher.example.test>" },
          { name: "Subject", value: "Re: Guest post idea" },
        ],
        mimeType: "text/plain",
        body: {
          data: Buffer.from("We are happy to publish the article.", "utf8").toString("base64url"),
        },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          const params = new URLSearchParams(String(init?.body));
          if (params.get("grant_type") === "authorization_code") {
            return Response.json({
              access_token: "test-access-token",
              refresh_token: "test-refresh-token",
            });
          }
          return Response.json({ access_token: "test-refreshed-access-token" });
        }
        if (url.endsWith("/profile")) {
          return Response.json({ emailAddress: "owner@example.test" });
        }
        if (url.includes("/messages?")) {
          return Response.json({ messages: [{ id: gmailMessage.id }] });
        }
        if (url.endsWith(`/messages/${gmailMessage.id}?format=full`)) {
          return Response.json(gmailMessage);
        }
        throw new Error(`Unexpected Gmail test request: ${url}`);
      }),
    );

    expect(await finishGmailAuthorization(state, "test-authorization-code")).toBe(
      `/campaigns/${campaignId}`,
    );
    expect(
      await db
        .select()
        .from(gmail_oauth_states)
        .where(eq(gmail_oauth_states.state_hash, createHash("sha256").update(state).digest("hex")))
        .get(),
    ).toBeUndefined();
    const savedConnection = await db
      .select()
      .from(gmail_connections)
      .where(eq(gmail_connections.user_id, userId))
      .get();
    expect(savedConnection).toBeTruthy();
    expect(savedConnection?.refresh_token_encrypted).not.toContain("test-refresh-token");

    const firstSync = await syncCampaignReplies(userId, campaignId);
    expect(firstSync).toEqual({ checked: 1, newReplies: 1 });
    const updatedProspect = await db
      .select()
      .from(prospects)
      .where(eq(prospects.id, prospectId))
      .get();
    expect(updatedProspect?.status).toBe("Replied");
    expect(updatedProspect?.workflow_status).toBe("Awaiting Final Approval");
    expect(updatedProspect?.submission_completed_at).toBeNull();
    expect(
      await db
        .select()
        .from(inbound_email_replies)
        .where(eq(inbound_email_replies.gmail_message_id, gmailMessage.id))
        .all(),
    ).toHaveLength(1);

    const secondSync = await syncCampaignReplies(userId, campaignId);
    expect(secondSync).toEqual({ checked: 1, newReplies: 0 });
  });
});

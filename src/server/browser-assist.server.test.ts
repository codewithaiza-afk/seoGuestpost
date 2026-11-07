import { eq } from "drizzle-orm";

process.env["TURSO_DATABASE_URL"] = "file::memory:";
delete process.env["TURSO_AUTH_TOKEN"];
process.env["BROWSER_SESSION_ENCRYPTION_KEY"] = "browser-test-secret-with-at-least-32-characters";

const { closeDatabase, db } = await import("./database");
const { browserSessionEncryption, isGuestSubmissionForm, submitProspectBrowserForm } =
  await import("./browser-assist.server");
const { browser_sessions, campaigns, prospects, users } = await import("../../drizzle/schema");

describe("isolated Playwright browser sessions", () => {
  let userId = "";
  let prospectId = "";

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "browser-test@example.test",
        password_hash: "test-scrypt-hash",
        full_name: "Browser Test",
      })
      .returning();
    if (!user) throw new Error("Browser test user was not created.");
    userId = user.id;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        user_id: userId,
        name: "Browser test",
        target_url: "https://example.test/",
        target_anchor: "example",
        niche: "Testing",
      })
      .returning();
    if (!campaign) throw new Error("Browser test campaign was not created.");

    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaign.id,
        domain: "publisher.example.test",
        submission_approved: true,
        submission_url: "https://publisher.example.test/write-for-us",
      })
      .returning();
    if (!prospect) throw new Error("Browser test prospect was not created.");
    prospectId = prospect.id;
  });

  afterAll(() => {
    closeDatabase();
  });

  it("encrypts session state and persists it under the owning user and prospect", async () => {
    const sessionState = JSON.stringify({
      cookies: [{ name: "auth", value: "private-token" }],
      origins: [],
    });
    const encryptedState = browserSessionEncryption.encrypt(sessionState);

    expect(encryptedState).not.toContain("private-token");
    expect(browserSessionEncryption.decrypt(encryptedState)).toBe(sessionState);

    await db
      .insert(browser_sessions)
      .values({
        user_id: userId,
        prospect_id: prospectId,
        storage_state_encrypted: encryptedState,
        last_url: "https://publisher.example.test/write-for-us",
      })
      .run();

    const saved = await db
      .select()
      .from(browser_sessions)
      .where(eq(browser_sessions.prospect_id, prospectId))
      .get();
    expect(saved?.storage_state_encrypted).toBe(encryptedState);
    expect(saved?.storage_state_encrypted).not.toContain("private-token");
  });

  it("rejects encrypted state after the key is changed", () => {
    const encryptedState = browserSessionEncryption.encrypt("session");
    process.env["BROWSER_SESSION_ENCRYPTION_KEY"] = "different-secret-with-at-least-32-characters";
    expect(() => browserSessionEncryption.decrypt(encryptedState)).toThrow();
    process.env["BROWSER_SESSION_ENCRYPTION_KEY"] =
      "browser-test-secret-with-at-least-32-characters";
  });

  it("does not mistake the Websolindia contact form for an article submission form", () => {
    const contactFormFields = [
      "Name*",
      "Email*",
      "Mobile*",
      "Location*",
      "Message*",
      "Security Check*",
    ].map((label) => ({ label, manualOnly: /security/i.test(label) }));

    expect(
      isGuestSubmissionForm(
        "Write For Us | Guest Post on SEO, Web Design & Digital Marketing | Websolindia",
        contactFormFields,
      ),
    ).toBe(false);
    expect(
      isGuestSubmissionForm("Submit a Guest Post", [
        { label: "Article Title", manualOnly: false },
        { label: "Article Content", manualOnly: false },
      ]),
    ).toBe(true);
  });

  it("requires explicit final approval before any submit attempt", async () => {
    await expect(
      submitProspectBrowserForm(userId, "not-needed", prospectId, false, false),
    ).rejects.toThrow("Final article approval is required");
  });

  it("persists submission attempt and confirmation metadata columns", async () => {
    await db
      .update(prospects)
      .set({
        submission_attempted_at: "2026-11-06T14:00:00.000Z",
        submission_result_url: "https://publisher.example.test/thank-you",
        submission_reference: "SUB-12345",
      })
      .where(eq(prospects.id, prospectId))
      .run();

    const saved = await db.select().from(prospects).where(eq(prospects.id, prospectId)).get();
    expect(saved?.submission_attempted_at).toBe("2026-11-06T14:00:00.000Z");
    expect(saved?.submission_result_url).toBe("https://publisher.example.test/thank-you");
    expect(saved?.submission_reference).toBe("SUB-12345");
  });
});

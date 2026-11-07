import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const testDirectory = join(tmpdir(), `linkforge-sqlite-${randomUUID()}`);
const databasePath = join(testDirectory, "guest-posting.sqlite");
const backupDirectory = join(testDirectory, "backups");

process.env["DATABASE_PATH"] = databasePath;
process.env["DATABASE_BACKUP_DIR"] = backupDirectory;

const { closeDatabase, createDatabaseBackup, db } = await import("./database");
const { campaigns, outreach_logs, prospects, users } = await import("../../drizzle/schema");

describe("local SQLite database", () => {
  let userId = "";
  let campaignId = "";
  let prospectId = "";

  beforeAll(async () => {
    mkdirSync(testDirectory, { recursive: true });
    const [user] = await db
      .insert(users)
      .values({
        email: "local-test@example.test",
        password_hash: "test-scrypt-hash",
        full_name: "Local Test",
      })
      .returning()
      .all();
    if (!user) throw new Error("Test user was not created.");
    userId = user.id;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        user_id: user.id,
        name: "SQLite persistence test",
        target_url: "https://example.test/",
        target_anchor: "example",
        niche: "Testing",
      })
      .returning()
      .all();
    if (!campaign) throw new Error("Test campaign was not created.");
    campaignId = campaign.id;

    const [prospect] = await db
      .insert(prospects)
      .values({
        campaign_id: campaign.id,
        domain: "publisher.example.test",
        submission_url: "https://publisher.example.test/write-for-us",
        login_url: "https://publisher.example.test/login",
        workflow_status: "Awaiting Approval",
        submission_details: [{ kind: "guest-post", eligibility: "free" }],
      })
      .returning()
      .all();
    if (!prospect) throw new Error("Test prospect was not created.");
    prospectId = prospect.id;
  });

  afterAll(() => {
    closeDatabase();
  });

  it("creates the schema, persists discovery details, and enforces unique prospects", async () => {
    const prospect = await db.select().from(prospects).where(eq(prospects.id, prospectId)).get();
    expect(prospect?.submission_url).toBe("https://publisher.example.test/write-for-us");
    expect(prospect?.submission_details).toEqual([{ kind: "guest-post", eligibility: "free" }]);

    await expect(
      db
        .insert(prospects)
        .values({ campaign_id: campaignId, domain: "publisher.example.test" })
        .run(),
    ).rejects.toThrow();
    expect(await db.$client.execute("PRAGMA integrity_check")).toMatchObject({
      rows: [{ integrity_check: "ok" }],
    });
    expect((await db.$client.execute("PRAGMA foreign_key_check")).rows).toHaveLength(0);
    expect(
      await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .get(),
    ).toBeTruthy();
  });

  it("creates and validates a persistent database backup", async () => {
    const backupPath = join(backupDirectory, "backup-test.sqlite");
    expect(await createDatabaseBackup(backupPath)).toBe(backupPath);

    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    const savedProspect = backup
      .prepare("SELECT COUNT(*) AS count FROM prospects WHERE id = ?")
      .get(prospectId) as { count: number };
    expect(savedProspect.count).toBe(1);
    backup.close();
  });

  it("cascades deletes inside SQLite transactions", async () => {
    const result = await db.transaction(async (transaction) => {
      await transaction
        .insert(outreach_logs)
        .values({
          prospect_id: prospectId,
          subject: "Test",
          body: "Test",
          resend_email_id: "local-test",
        })
        .run();
      return transaction.delete(campaigns).where(eq(campaigns.id, campaignId)).run();
    });

    expect(result.rowsAffected).toBe(1);
    expect(
      await db.select().from(prospects).where(eq(prospects.id, prospectId)).get(),
    ).toBeUndefined();
    expect(await db.select().from(outreach_logs).all()).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, userId)).get()).toBeTruthy();
  });
});

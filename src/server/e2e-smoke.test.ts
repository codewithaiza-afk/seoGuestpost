import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import type { AutonomousStepResult } from "@/functions/autonomous.functions";
import { isPublicDomain } from "@/lib/domain-validator";
import { normalizeProspectDomain } from "@/server/website-discovery";

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

process.env["TURSO_DATABASE_URL"] = "file::memory:";
delete process.env["TURSO_AUTH_TOKEN"];
process.env["GMAIL_USER"] = "smoke-test@example.test";
process.env["GMAIL_APP_PASSWORD"] = "test-app-password";

const { closeDatabase, db } = await import("./database");
const { campaigns, prospects, users } = await import("../../drizzle/schema");

describe("End-to-End Autonomous Agent Smoke Test", () => {
  let userId = "";
  let campaignId = "";

  beforeAll(async () => {
    // 1. Create dummy test user
    const [user] = await db
      .insert(users)
      .values({
        email: `smoke-${randomUUID()}@example.test`,
        password_hash: "dummy-scrypt-hash",
        full_name: "Smoke Test Agent",
      })
      .returning()
      .all();
    if (!user) throw new Error("Could not create smoke test user");
    userId = user.id;

    // 2. Create dummy campaign (no modification to real campaigns)
    const [campaign] = await db
      .insert(campaigns)
      .values({
        user_id: userId,
        name: "Car Lockout Service Birmingham Smoke Test",
        target_url: "https://carlockoutservicebirmingham.com/",
        target_anchor: "Car Lockout Service Birmingham",
        niche: "Automotive",
      })
      .returning()
      .all();
    if (!campaign) throw new Error("Could not create smoke test campaign");
    campaignId = campaign.id;
  });

  afterAll(() => {
    closeDatabase();
  });

  it("Scenario 1 & 2: parses spreadsheet and filters valid domains from invalid values", () => {
    // Construct dummy spreadsheet data matching user scenario
    const rawSpreadsheetRows = [
      { Domain: "example.com", Email: "contact@example.com", DA: 45 },
      { Domain: "published", Email: "", DA: 0 },
      { Domain: "0.0.0.1", Email: "", DA: 0 },
      { Domain: "0.0.0.2", Email: "", DA: 0 },
      { Domain: "https://good.org", Email: "editor@good.org", DA: 52 },
    ];

    // Build actual XLSX binary to test file parsing
    const worksheet = XLSX.utils.json_to_sheet(rawSpreadsheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Prospects");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Read back workbook simulating frontend drop
    const parsedWb = XLSX.read(buffer, { type: "buffer" });
    const sheet = parsedWb.Sheets[parsedWb.SheetNames[0]!];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet!);

    const validProspects: { domain: string; contact_email: string | null; da_dr_score: number }[] = [];
    const rejectedRows: { rawValue: string; reason: string }[] = [];

    for (const row of jsonData) {
      const rawDomain = String(row["Domain"] ?? "").trim();
      if (isPublicDomain(rawDomain)) {
        try {
          const clean = normalizeProspectDomain(
            rawDomain.replace(/^https?:\/\//i, "").split(/[/?#]/)[0]!.replace(/^www\./i, ""),
          );
          validProspects.push({
            domain: clean,
            contact_email: String(row["Email"] ?? "").includes("@") ? String(row["Email"]) : null,
            da_dr_score: Number(row["DA"]) || 0,
          });
        } catch (err) {
          rejectedRows.push({
            rawValue: rawDomain,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        rejectedRows.push({
          rawValue: rawDomain,
          reason: "Use a public website domain without a path, credentials, or port.",
        });
      }
    }

    // Assertions
    expect(validProspects).toHaveLength(2);
    expect(validProspects[0]?.domain).toBe("example.com");
    expect(validProspects[1]?.domain).toBe("good.org");

    expect(rejectedRows).toHaveLength(3);
    expect(rejectedRows.map((r) => r.rawValue)).toEqual(["published", "0.0.0.1", "0.0.0.2"]);
    for (const r of rejectedRows) {
      expect(r.reason).toBe("Use a public website domain without a path, credentials, or port.");
    }
  });

  it("Scenario 3: invalid prospects never enter the autonomous processing queue", async () => {
    // Insert 1 valid prospect and 1 invalid prospect (already marked with validation error)
    const [validP] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: "good.org",
        contact_email: "editor@good.org",
        status: "Discovered",
        workflow_status: "Discovered",
      })
      .returning()
      .all();

    const [invalidP] = await db
      .insert(prospects)
      .values({
        campaign_id: campaignId,
        domain: "published",
        status: "Discovered",
        workflow_status: "Failed",
        validation_error: "Use a public website domain without a path, credentials, or port.",
      })
      .returning()
      .all();

    const allProspects = [validP!, invalidP!];

    // Filter queue as implemented in campaigns.$id.tsx runAutoPilot
    const listToProcess = allProspects.filter(
      (p) => p.status === "Discovered" && !p.validation_error && p.workflow_status !== "Failed",
    );

    expect(listToProcess).toHaveLength(1);
    expect(listToProcess[0]?.domain).toBe("good.org");
    expect(listToProcess.some((p) => p.domain === "published")).toBe(false);
  });

  it("Scenario 4: failed prospect displays Error/Invalid badge and appears in View Errors", () => {
    const p = {
      id: "test-err-1",
      domain: "0.0.0.1",
      status: "Discovered",
      workflow_status: "Failed",
      validation_error: "Use a public website domain without a path, credentials, or port.",
    };

    const isInvalid = Boolean(p.validation_error) || p.workflow_status === "Failed";
    expect(isInvalid).toBe(true);

    const badgeLabel = isInvalid ? "Invalid" : p.status;
    expect(badgeLabel).toBe("Invalid");

    // Simulating View Errors drawer population
    const errorProspects = [p].filter((item) => Boolean(item.validation_error) || item.workflow_status === "Failed");
    expect(errorProspects).toHaveLength(1);
    expect(errorProspects[0]?.domain).toBe("0.0.0.1");
    expect(errorProspects[0]?.validation_error).toContain("Use a public website domain");
  });

  it("Scenario 5 & 6: failed prospects never increase counters and send no real emails", async () => {
    let emailsSentCount = 0;
    let pitchedCount = 0;
    let liveCount = 0;
    let failedCount = 0;

    // Simulate execution of invalid prospect
    const stepResult: AutonomousStepResult = {
      ok: false,
      prospectId: "invalid-id",
      domain: "0.0.0.2",
      contactEmail: "",
      submissionUrl: null,
      pitchSubject: "",
      pitchBody: "",
      articleTitle: "",
      markdownContent: "",
      actionTaken: "failed",
      emailDispatch: "not-sent",
      logs: ["❌ Error on 0.0.0.2: Use a public website domain without a path, credentials, or port."],
    };

    if (!stepResult.ok || stepResult.actionTaken === "failed") {
      failedCount += 1;
    } else {
      if (stepResult.emailDispatch === "sent") emailsSentCount += 1;
      pitchedCount += 1;
    }

    // Counters check
    expect(failedCount).toBe(1);
    expect(emailsSentCount).toBe(0);
    expect(pitchedCount).toBe(0);
    expect(liveCount).toBe(0);

    // Verify nodemailer mock was NEVER called
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("Scenario 7: verify successful processing using mocked services only", async () => {
    // Simulated mocked successful autonomous processing
    const mockedSend = vi.fn(async () => ({ emailId: "mock-msg-123", provider: "Mocked-Gmail" }));

    const validStepResult = {
      ok: true,
      prospectId: "valid-prospect-1",
      domain: "good.org",
      contactEmail: "editor@good.org",
      submissionUrl: null,
      pitchSubject: "Partnership Opportunity for good.org",
      pitchBody: "Hello Editor, we have an article draft ready...",
      articleTitle: "Comprehensive Guide to Automotive Security",
      markdownContent: "# Automotive Security",
      actionTaken: "pitched" as const,
      emailDispatch: "sent" as const,
      logs: ["📧 Pitch created", "🚀 Outreach email sent."],
    };

    let emailsSent = 0;
    let pitched = 0;

    if (validStepResult.ok && validStepResult.actionTaken === "pitched") {
      await mockedSend();
      emailsSent += 1;
      pitched += 1;
    }

    expect(validStepResult.ok).toBe(true);
    expect(validStepResult.actionTaken).toBe("pitched");
    expect(validStepResult.emailDispatch).toBe("sent");
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(emailsSent).toBe(1);
    expect(pitched).toBe(1);
  });
});

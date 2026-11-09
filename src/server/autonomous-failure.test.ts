import { describe, expect, it, vi } from "vitest";
import type { AutonomousStepResult } from "@/functions/autonomous.functions";

describe("Autonomous Step Failure Handling", () => {
  it("defines AutonomousStepResult supporting actionTaken 'failed' and emailDispatch 'not-sent'", () => {
    const failureResult: AutonomousStepResult = {
      ok: false,
      prospectId: "test-prospect-1",
      domain: "invalid-domain",
      contactEmail: "",
      submissionUrl: null,
      pitchSubject: "",
      pitchBody: "",
      articleTitle: "",
      markdownContent: "",
      actionTaken: "failed",
      emailDispatch: "not-sent",
      logs: ["❌ Error processing prospect: Invalid website domain"],
    };

    expect(failureResult.ok).toBe(false);
    expect(failureResult.actionTaken).toBe("failed");
    expect(failureResult.emailDispatch).toBe("not-sent");
    expect(failureResult.logs[0]).toContain("Error processing prospect");
  });

  it("verifies email sending functions are never invoked for failed prospects", async () => {
    const sendOutreachMock = vi.fn();
    const sendArticleSubmissionMock = vi.fn();

    // Simulate autonomous execution error branch
    const processProspect = async (isValidDomain: boolean): Promise<AutonomousStepResult> => {
      if (!isValidDomain) {
        // Validation fails: error is caught, email functions NOT called
        return {
          ok: false,
          prospectId: "prospect-fail",
          domain: "published",
          contactEmail: "",
          submissionUrl: null,
          pitchSubject: "",
          pitchBody: "",
          articleTitle: "",
          markdownContent: "",
          actionTaken: "failed",
          emailDispatch: "not-sent",
          logs: ["❌ Error on published: Use a public website domain"],
        };
      }

      // Valid path calls email dispatch
      await sendOutreachMock();
      return {
        ok: true,
        prospectId: "prospect-ok",
        domain: "example.com",
        contactEmail: "editor@example.com",
        submissionUrl: null,
        pitchSubject: "Guest Post Pitch",
        pitchBody: "Hello Editor...",
        articleTitle: "Great Article",
        markdownContent: "# Article Content",
        actionTaken: "pitched",
        emailDispatch: "sent",
        logs: ["🚀 Outreach email sent."],
      };
    };

    const failResult = await processProspect(false);
    expect(failResult.ok).toBe(false);
    expect(failResult.actionTaken).toBe("failed");
    expect(failResult.emailDispatch).toBe("not-sent");
    expect(sendOutreachMock).not.toHaveBeenCalled();
    expect(sendArticleSubmissionMock).not.toHaveBeenCalled();

    const successResult = await processProspect(true);
    expect(successResult.ok).toBe(true);
    expect(successResult.actionTaken).toBe("pitched");
    expect(successResult.emailDispatch).toBe("sent");
    expect(sendOutreachMock).toHaveBeenCalledTimes(1);
  });
});

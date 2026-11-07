import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import { prospects } from "../../drizzle/schema";
import { normalizeSubmissionUrl } from "@/lib/submission-url";
import { db } from "@/server/database";
import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import { getOwnedProspect } from "@/server/owned-records";

export const saveSubmissionApproval = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { campaignId: string; prospectId: string; submissionUrl: string; approved: boolean }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
    if (!prospect) throw new Error("Prospect not found");

    const submissionUrl = normalizeSubmissionUrl(data.submissionUrl, prospect.domain);
    if (data.approved && !submissionUrl) {
      throw new Error("A submission page is required before approving this site.");
    }

    await db
      .update(prospects)
      .set({
        submission_url: submissionUrl,
        submission_approved: data.approved,
        submission_completed_at: null,
        workflow_status: data.approved ? "Approved" : "Awaiting Approval",
      })
      .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
      .run();

    return { submissionUrl, approved: data.approved };
  });

export const confirmManualSubmission = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
    if (!prospect) throw new Error("Prospect not found");
    if (!prospect.submission_approved || !prospect.submission_url) {
      throw new Error("Approve the site's submission page before confirming a submission.");
    }
    if (!normalizeSubmissionUrl(prospect.submission_url, prospect.domain)) {
      throw new Error("The submission page URL is not valid for this prospect.");
    }

    await db
      .update(prospects)
      .set({
        submission_completed_at: new Date().toISOString(),
        workflow_status: "Submitted",
      })
      .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
      .run();

    return { ok: true };
  });

export const rejectSubmissionCandidate = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator((input: { campaignId: string; prospectId: string }) => input)
  .handler(async ({ data, context }) => {
    if (!(await getOwnedProspect(context.userId, data.campaignId, data.prospectId))) {
      throw new Error("Prospect not found");
    }
    await db
      .update(prospects)
      .set({ workflow_status: "Rejected", submission_approved: false })
      .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
      .run();
    return { ok: true };
  });

export const recordManualAuthStep = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: {
      campaignId: string;
      prospectId: string;
      workflowStatus: "Login Required" | "Signup Required" | "Manual Action Required";
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
    if (!prospect) throw new Error("Prospect not found");
    if (!prospect.submission_approved) {
      throw new Error("Approve the prospect before opening its account page.");
    }

    const storedAuthUrl =
      data.workflowStatus === "Signup Required"
        ? prospect.signup_url
        : data.workflowStatus === "Manual Action Required"
          ? prospect.submission_url
          : prospect.login_url;
    if (!storedAuthUrl) {
      throw new Error("No matching account page was discovered for this website.");
    }
    const authUrl = normalizeSubmissionUrl(storedAuthUrl, prospect.domain);
    if (!authUrl) throw new Error("The account page URL is not valid for this prospect.");

    await db
      .update(prospects)
      .set({ workflow_status: data.workflowStatus })
      .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
      .run();
    return { authUrl };
  });

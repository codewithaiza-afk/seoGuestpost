import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import { prospects, type Json } from "../../drizzle/schema";
import { normalizeSubmissionUrl } from "@/lib/submission-url";
import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";
import { db } from "@/server/database";
import { getOwnedCampaign, getOwnedProspect } from "@/server/owned-records";
import { scanProspectWebsite } from "@/server/autonomous.server";
import {
  generatePitchForProspect,
  generateArticleForProspect,
  type BusinessContextPayload,
} from "@/server/pitch.server";
import { sendArticleSubmissionEmail, sendOutreachEmail } from "@/server/outreach.server";

export interface AutonomousStepResult {
  ok: boolean;
  prospectId: string;
  domain: string;
  contactEmail: string;
  submissionUrl: string | null;
  pitchSubject: string;
  pitchBody: string;
  articleTitle: string;
  markdownContent: string;
  actionTaken: "submission" | "pitched";
  emailDispatch: "sent" | "duplicate" | "missing-contact";
  logs: string[];
}

export const runAutonomousProspectStep = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { campaignId: string; prospectId: string; businessInfo?: BusinessContextPayload }) =>
      input,
  )
  .handler(async ({ data, context }): Promise<AutonomousStepResult> => {
    const logs: string[] = [];

    // 1. Fetch Campaign and Prospect
    const campaign = await getOwnedCampaign(context.userId, data.campaignId);
    if (!campaign) throw new Error("Campaign not found");

    const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
    if (!prospect) throw new Error("Prospect not found");

    const brandName = data.businessInfo?.businessName || campaign.name;
    logs.push(`🔍 Initiating autonomous scan for: ${prospect.domain}`);

    // 2. Scan website for direct publishing capabilities & editor contact email
    const analysis = await scanProspectWebsite(prospect.domain);
    logs.push(...analysis.notes);

    const availableContactEmail = prospect.contact_email?.trim() || analysis.foundEmail;
    const contactEmail = availableContactEmail || "";

    // 3. Generate High-Value SEO Guest Post Article tailored to business context with Backlink
    logs.push(
      `✍️ Generating tailored guest post for [${brandName}] with backlink [${campaign.target_anchor}]...`,
    );
    const article = await generateArticleForProspect(
      context.userId,
      data.campaignId,
      data.prospectId,
      undefined,
      data.businessInfo,
    );
    logs.push(`✅ Article generated: "${article.title}" (Backlink integrated)`);

    let pitchSubject = "";
    let pitchBody = "";
    let emailDispatch: AutonomousStepResult["emailDispatch"] = "missing-contact";
    let submissionUrl: string | null = null;
    let actionTaken: AutonomousStepResult["actionTaken"] = "pitched";
    const guestPostPages = analysis.opportunities.filter((page) => page.kind === "guest-post");
    const freeOrUnpricedPage =
      guestPostPages.find((page) => page.eligibility === "free") ??
      guestPostPages.find((page) => page.eligibility === "unknown");
    const candidatePage = freeOrUnpricedPage ?? guestPostPages[0] ?? null;

    submissionUrl = candidatePage
      ? normalizeSubmissionUrl(candidatePage.url, prospect.domain)
      : null;
    const workflowStatus = freeOrUnpricedPage
      ? prospect.submission_approved && submissionUrl === prospect.submission_url
        ? ("Approved" as const)
        : ("Awaiting Approval" as const)
      : ("Email Outreach" as const);
    const submissionPatch = {
      submission_details: JSON.parse(JSON.stringify(analysis.opportunities)) as Json,
      login_url: analysis.loginUrl,
      signup_url: analysis.signupUrl,
      workflow_status: freeOrUnpricedPage ? workflowStatus : prospect.workflow_status,
      ...(!prospect.contact_email && availableContactEmail
        ? { contact_email: availableContactEmail }
        : {}),
      ...(submissionUrl && submissionUrl !== prospect.submission_url
        ? {
            submission_url: submissionUrl,
            submission_approved: false,
            submission_completed_at: null,
          }
        : {}),
    };
    let savedProspect: { id: string } | undefined;
    try {
      [savedProspect] = await db
        .update(prospects)
        .set(submissionPatch)
        .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
        .returning({ id: prospects.id })
        .all();
    } catch (error) {
      console.error("[autopilot] Save discovered website details failed", error);
      throw new Error(
        `Save discovered website details failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!savedProspect) {
      throw new Error(
        "Save discovered website details failed: prospect not found or update not permitted (0 rows updated).",
      );
    }
    if (!prospect.contact_email && availableContactEmail) {
      logs.push(`💾 Saved extracted contact to prospect: ${contactEmail}`);
    }

    if (freeOrUnpricedPage && submissionUrl) {
      actionTaken = "submission";
      logs.push(
        `📝 Guest-post page found at ${submissionUrl} (eligibility: ${freeOrUnpricedPage.eligibility}). The website form is not submitted automatically.`,
      );
      if (!availableContactEmail) {
        logs.push(
          "⚠️ No editor contact email was found. The article was not sent to an invented address.",
        );
      } else {
        logs.push(
          `📨 Sending the generated article draft to editor contact ${availableContactEmail}...`,
        );
        const dispatch = await sendArticleSubmissionEmail(
          context.userId,
          data.campaignId,
          data.prospectId,
          article.title,
          article.markdownContent,
          true,
        );
        emailDispatch = dispatch.duplicate ? "duplicate" : "sent";
        logs.push(
          dispatch.duplicate
            ? "ℹ️ This exact article draft was already sent; skipped duplicate delivery."
            : `🚀 Article draft accepted by ${dispatch.provider} for delivery (message ID: ${dispatch.emailId}).`,
        );
      }
    } else {
      // 4. Generate and send an outreach pitch when no guest-post page was found.
      logs.push(
        `🤖 Drafting hyper-personalized pitch from [${brandName}] to ${prospect.domain}...`,
      );
      const pitch = await generatePitchForProspect(
        context.userId,
        data.campaignId,
        data.prospectId,
        data.businessInfo,
        {
          recentArticleTitle: analysis.recentArticleTitle,
          siteHeadline: analysis.siteHeadline,
        },
      );
      pitchSubject = pitch.subject;
      pitchBody = pitch.body;
      logs.push(`📧 Pitch created: "${pitch.subject}"`);

      if (!availableContactEmail) {
        throw new Error(
          `No editor contact email was found for ${prospect.domain}; refusing to invent an address.`,
        );
      }
      logs.push(`📨 Dispatching outreach email to ${contactEmail}...`);
      await sendOutreachEmail(
        context.userId,
        data.campaignId,
        data.prospectId,
        pitch.subject,
        pitch.body,
      );
      emailDispatch = "sent";
      logs.push(`🚀 Outreach completed! Status updated to "Pitched".`);
    }

    return {
      ok: true,
      prospectId: data.prospectId,
      domain: prospect.domain,
      contactEmail,
      submissionUrl,
      pitchSubject,
      pitchBody,
      articleTitle: article.title,
      markdownContent: article.markdownContent,
      actionTaken,
      emailDispatch,
      logs,
    };
  });

export const sendProspectOutreachInstead = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(
    (input: { campaignId: string; prospectId: string; businessInfo?: BusinessContextPayload }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const pitch = await generatePitchForProspect(
      context.userId,
      data.campaignId,
      data.prospectId,
      data.businessInfo,
    );
    await sendOutreachEmail(
      context.userId,
      data.campaignId,
      data.prospectId,
      pitch.subject,
      pitch.body,
    );
    return pitch;
  });

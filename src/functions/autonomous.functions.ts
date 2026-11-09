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
  actionTaken: "submission" | "pitched" | "failed";
  emailDispatch: "sent" | "duplicate" | "missing-contact" | "not-sent";
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
    let prospectDomain = "";
    try {
      // -----------------------------------------------------------------
      // 1️⃣ Load campaign & prospect (ownership already verified)
      // -----------------------------------------------------------------
      const campaign = await getOwnedCampaign(context.userId, data.campaignId);
      if (!campaign) throw new Error("Campaign not found");

      const prospect = await getOwnedProspect(context.userId, data.campaignId, data.prospectId);
      if (!prospect) throw new Error("Prospect not found");
      prospectDomain = prospect.domain;

      const brandName = data.businessInfo?.businessName || campaign.name;
      logs.push(`🔍 Scanning ${prospect.domain}`);

      // -----------------------------------------------------------------
      // 2️⃣ Scan website for guest‑post opportunities
      // -----------------------------------------------------------------
      const analysis = await scanProspectWebsite(prospect.domain);
      logs.push(...analysis.notes);

      const availableContactEmail = prospect.contact_email?.trim() || analysis.foundEmail;
      const contactEmail = availableContactEmail || "";

      // -----------------------------------------------------------------
      // 3️⃣ Generate article (always runs, even if no guest‑post page)
      // -----------------------------------------------------------------
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
      logs.push(`✅ Article generated: "${article.title}"`);

      // -----------------------------------------------------------------
      // 4️⃣ Determine whether we have a free guest‑post page
      // -----------------------------------------------------------------
      const guestPostPages = analysis.opportunities.filter((page) => page.kind === "guest-post");
      const freeOrUnpricedPage =
        guestPostPages.find((page) => page.eligibility === "free") ??
        guestPostPages.find((page) => page.eligibility === "unknown");
      const candidatePage = freeOrUnpricedPage ?? guestPostPages[0] ?? null;

      let submissionUrl: string | null = null;
      let actionTaken: AutonomousStepResult["actionTaken"] = "pitched";
      let emailDispatch: AutonomousStepResult["emailDispatch"] = "missing-contact";
      let pitchSubject = "";
      let pitchBody = "";

      if (candidatePage) {
        // Normalise URL and ensure it belongs to prospect domain
        submissionUrl = normalizeSubmissionUrl(candidatePage.url, prospect.domain);
        actionTaken = "submission";
        logs.push(
          `📝 Guest‑post page found at ${submissionUrl} (eligibility: ${freeOrUnpricedPage?.eligibility ?? "unknown"})`,
        );
        if (availableContactEmail) {
          logs.push(`📨 Sending article draft to ${availableContactEmail}...`);
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
              ? "ℹ️ Duplicate article draft – not sent."
              : `🚀 Article draft accepted (provider: ${dispatch.provider}).`,
          );
        } else {
          logs.push("⚠️ No editor contact – article not sent.");
        }
      } else {
        // -----------------------------------------------------------------
        // 5️⃣ No guest‑post page → prepare outreach pitch
        // -----------------------------------------------------------------
        logs.push(`🤖 Drafting outreach pitch for ${prospect.domain}...`);
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

        if (availableContactEmail) {
          logs.push(`📨 Dispatching outreach email to ${availableContactEmail}...`);
          await sendOutreachEmail(
            context.userId,
            data.campaignId,
            data.prospectId,
            pitch.subject,
            pitch.body,
          );
          emailDispatch = "sent";
          logs.push("🚀 Outreach email sent.");
        } else {
          throw new Error(`No editor contact email for ${prospect.domain}`);
        }
      }

      // -----------------------------------------------------------------
      // 6️⃣ Persist updates (submission details, status, etc.)
      // -----------------------------------------------------------------
      const workflowStatus =
        freeOrUnpricedPage && availableContactEmail && submissionUrl === prospect.submission_url
          ? "Approved"
          : freeOrUnpricedPage
          ? "Awaiting Approval"
          : "Email Outreach";

      const patch: Partial<typeof prospects.$inferInsert> = {
        submission_details: JSON.parse(JSON.stringify(analysis.opportunities)) as Json,
        login_url: analysis.loginUrl,
        signup_url: analysis.signupUrl,
        workflow_status: freeOrUnpricedPage ? workflowStatus : prospect.workflow_status,
        ...(availableContactEmail && !prospect.contact_email
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
      await db
        .update(prospects)
        .set(patch)
        .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
        .run();

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
    } catch (err) {
      // -----------------------------------------------------------------
      // 7️⃣ Handle any failure – mark prospect as Error, record validation_error
      // -----------------------------------------------------------------
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`❌ Error processing prospect: ${message}`);
      // Update prospect status + validation_error (if column exists)
      await db
        .update(prospects)
        .set({
          status: "Discovered" as const,
          workflow_status: "Failed" as const,
          validation_error: message,
        })
        .where(and(eq(prospects.id, data.prospectId), eq(prospects.campaign_id, data.campaignId)))
        .run();
      return {
        ok: false,
        prospectId: data.prospectId,
        domain: prospectDomain,
        contactEmail: "",
        submissionUrl: null,
        pitchSubject: "",
        pitchBody: "",
        articleTitle: "",
        markdownContent: "",
        actionTaken: "failed",
        emailDispatch: "not-sent",
        logs,
      };
    }
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

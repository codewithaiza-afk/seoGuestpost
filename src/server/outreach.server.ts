/**
 * Server-only outreach email utility.
 * Plain async function (NOT createServerFn) — callable from both
 * individual RPC handlers and the autonomous engine.
 *
 * Supports Real Gmail SMTP dispatch using Google App Passwords
 * as well as Resend gateway integration.
 */

import { and, desc, eq } from "drizzle-orm";
import nodemailer from "nodemailer";

import { outreach_logs, prospects } from "../../drizzle/schema";
import { db } from "@/server/database";
import { getOwnedCampaign, getOwnedProspect } from "@/server/owned-records";

const RESEND_GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const PUBLICATION_PERMISSION_REQUEST =
  "If your editorial process allows, we’d be grateful if your team could publish the article. Otherwise, please reply with your permission for us to submit it and any submission instructions or contributor access requirements. We will only submit it after receiving your approval.";

function includePublicationPermissionRequest(body: string): string {
  if (/reply with your permission for us to submit/i.test(body)) return body;
  return `${body.trim()}\n\n${PUBLICATION_PERMISSION_REQUEST}`;
}

function formatEmailError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown SMTP error";
  const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  return `${error.message}${code}`;
}

export interface OutreachResult {
  sent: boolean;
  emailId: string | null;
  provider: "gmail" | "resend" | "local";
  duplicate?: boolean;
}

/**
 * Send an outreach pitch email for a prospect and log it.
 */
export async function sendOutreachEmail(
  userId: string,
  campaignId: string,
  prospectId: string,
  subject: string,
  body: string,
): Promise<OutreachResult> {
  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found");
  if (!prospect.contact_email) {
    throw new Error("This prospect has no contact email. Add one first.");
  }

  const gmailUser = process.env["GMAIL_USER"]?.trim() ?? "";
  const gmailPass = (process.env["GMAIL_APP_PASSWORD"] ?? "").replace(/\s+/g, "");

  const resendApiKey = process.env["RESEND_API_KEY"];
  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  const emailBody = includePublicationPermissionRequest(body);

  if ((!gmailUser || !gmailPass) && !(resendApiKey && lovableApiKey)) {
    const missing = [
      ...(!gmailUser ? ["GMAIL_USER"] : []),
      ...(!gmailPass ? ["GMAIL_APP_PASSWORD"] : []),
    ];
    throw new Error(
      `Outreach email was not sent. Configure ${missing.join(" and ")} in .env, then restart the app. For Gmail, use a Google App Password, not your account password or a verification code.`,
    );
  }

  let emailId: string | null = null;
  let provider: "gmail" | "resend" | "local" = "local";
  let gmailError: string | null = null;

  // 1. PRIMARY: Real Gmail SMTP Dispatch
  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      const htmlBody = emailBody
        .split(/\n{2,}/)
        .map(
          (para) =>
            `<p style="margin:0 0 16px;line-height:1.6;color:#1a1a2e;font-size:15px;font-family:sans-serif">${para
              .split("\n")
              .map((line, i, arr) => (i < arr.length - 1 ? `${line}<br>` : line))
              .join("")}</p>`,
        )
        .join("");

      const info = await transporter.sendMail({
        from: `"${gmailUser.split("@")[0]}" <${gmailUser}>`,
        to: prospect.contact_email,
        subject: subject,
        text: emailBody,
        html: htmlBody,
      });

      emailId = info.messageId || `gmail_${Date.now()}`;
      provider = "gmail";
      console.log(`[Gmail SMTP] Sent pitch to ${prospect.contact_email} (MsgID: ${emailId})`);
    } catch (gmailErr) {
      gmailError = formatEmailError(gmailErr);
      console.error("[Gmail SMTP Error]:", gmailErr instanceof Error ? gmailErr.message : gmailErr);
    }
  }

  // 2. SECONDARY: Resend Gateway
  if (!emailId && resendApiKey && lovableApiKey) {
    const from = process.env["RESEND_FROM_EMAIL"] ?? "LinkForge <onboarding@resend.dev>";
    const html = emailBody
      .split(/\n{2,}/)
      .map(
        (para) =>
          `<p style="margin:0 0 16px;line-height:1.6;color:#1a1a2e;font-size:15px">${para
            .split("\n")
            .map((line, i, arr) => (i < arr.length - 1 ? `${line}<br>` : line))
            .join("")}</p>`,
      )
      .join("");

    try {
      const response = await fetch(`${RESEND_GATEWAY_URL}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": resendApiKey,
        },
        body: JSON.stringify({
          from,
          to: [prospect.contact_email],
          subject,
          html,
        }),
      });

      if (response.ok) {
        const json = (await response.json()) as { id?: string };
        emailId = json.id ?? null;
        provider = "resend";
      } else {
        console.error(
          `[Resend Error] Email request failed with status ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      }
    } catch (err) {
      console.error("Resend network error:", err);
    }
  }

  if (!emailId) {
    throw new Error(
      gmailError
        ? `Outreach email was not sent. Gmail SMTP failed: ${gmailError}`
        : "Outreach email was not sent. Configure valid Gmail SMTP credentials or the Resend integration.",
    );
  }

  const nextStatus = ["Replied", "Live"].includes(prospect.status ?? "")
    ? prospect.status
    : "Pitched";
  await db.transaction(async (transaction) => {
    await transaction
      .update(prospects)
      .set({ status: nextStatus, workflow_status: "Email Outreach" })
      .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
      .run();
    await transaction
      .insert(outreach_logs)
      .values({ prospect_id: prospectId, subject, body: emailBody, resend_email_id: emailId })
      .run();
  });

  return { sent: true, emailId, provider };
}

/**
 * Send the full guest post draft to the verified editor contact.
 */
export async function sendArticleSubmissionEmail(
  userId: string,
  campaignId: string,
  prospectId: string,
  articleTitle: string,
  articleContent: string,
  skipDuplicate = false,
): Promise<OutreachResult> {
  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found");
  if (!prospect.contact_email) {
    throw new Error("This prospect has no contact email.");
  }

  const gmailUser = process.env["GMAIL_USER"]?.trim() ?? "";
  const gmailPass = (process.env["GMAIL_APP_PASSWORD"] ?? "").replace(/\s+/g, "");
  if (!gmailUser || !gmailPass) {
    throw new Error("Configure GMAIL_USER and GMAIL_APP_PASSWORD before sending article drafts.");
  }

  const subject = `Guest Post Draft: "${articleTitle}" for ${prospect.domain}`;
  if (skipDuplicate) {
    const previousSend = await db
      .select({ emailId: outreach_logs.resend_email_id })
      .from(outreach_logs)
      .where(and(eq(outreach_logs.prospect_id, prospectId), eq(outreach_logs.subject, subject)))
      .get();
    if (previousSend) {
      return {
        sent: false,
        emailId: previousSend.emailId,
        provider: "gmail",
        duplicate: true,
      };
    }
  }
  const emailText = `Hi Editor,\n\nI’m sharing the following guest post draft for your editorial review. Please let me know if it fits your publication guidelines.\n\n---\nTITLE: ${articleTitle}\n---\n\n${articleContent}\n\n---\nIf your editorial process allows, we’d be grateful if your team could publish the article. Otherwise, please reply with your permission for us to submit it and any submission instructions or contributor access requirements. We will only submit it after receiving your approval.\n\nThank you for your time and consideration.\n\nBest regards,\n${gmailUser.split("@")[0]}`;

  let emailId: string | null = null;
  let provider: "gmail" | "local" = "gmail";

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      const htmlBody = `
        <div style="font-family:sans-serif;line-height:1.6;color:#1e293b;max-width:680px">
          <p>Hi Editor,</p>
          <p>I’m sharing the following guest post draft for your editorial review. Please let me know if it fits your publication guidelines.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
          <pre style="background:#f8fafc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;white-space:pre-wrap;font-size:14px">${escapeHtml(`${articleTitle}\n\n${articleContent}`)}</pre>
          <p>${escapeHtml(PUBLICATION_PERMISSION_REQUEST)}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
          <p>Thank you for your time and consideration.</p>
          <p>Best regards,<br/><strong>${gmailUser.split("@")[0]}</strong></p>
        </div>
      `;

      const info = await transporter.sendMail({
        from: `"${gmailUser.split("@")[0]}" <${gmailUser}>`,
        to: prospect.contact_email,
        subject: subject,
        text: emailText,
        html: htmlBody,
      });

      emailId = info.messageId || `gmail_${Date.now()}`;
      provider = "gmail";
      console.log(`[Gmail SMTP] Dispatched article draft to ${prospect.contact_email}`);
    } catch (err) {
      const details = formatEmailError(err);
      console.error("[Gmail SMTP Article Dispatch Error]:", details);
      throw new Error(`The article email could not be sent through Gmail: ${details}`);
    }
  }

  if (!emailId) {
    throw new Error("Gmail did not return a message ID for the article email.");
  }

  const nextStatus = ["Replied", "Live"].includes(prospect.status ?? "")
    ? prospect.status
    : "Pitched";
  await db.transaction(async (transaction) => {
    await transaction
      .update(prospects)
      .set({ status: nextStatus, workflow_status: "Email Outreach" })
      .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
      .run();
    await transaction
      .insert(outreach_logs)
      .values({ prospect_id: prospectId, subject, body: emailText, resend_email_id: emailId })
      .run();
  });

  return { sent: true, emailId, provider };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

/**
 * Send an autonomous Follow-Up bump email via Gmail for stale pitches.
 */
export async function sendFollowUpEmail(
  userId: string,
  campaignId: string,
  prospectId: string,
  customNote?: string,
): Promise<OutreachResult> {
  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found");
  if (!prospect.contact_email) throw new Error("Prospect has no contact email");

  const campaign = await getOwnedCampaign(userId, campaignId);

  const brandName = campaign?.name || "Our Team";

  // Check previous log for subject
  const previousLog = await db
    .select({ subject: outreach_logs.subject })
    .from(outreach_logs)
    .where(eq(outreach_logs.prospect_id, prospectId))
    .orderBy(desc(outreach_logs.sent_at))
    .limit(1)
    .get();

  const prevSubject = previousLog?.subject;
  const followUpSubject = prevSubject
    ? prevSubject.startsWith("Re:")
      ? prevSubject
      : `Re: ${prevSubject}`
    : `Follow-Up: Guest Contribution for ${prospect.domain} from ${brandName}`;

  const defaultBody = [
    `Hi Editor,`,
    "",
    `I wanted to quickly follow up on my previous note regarding contributing a tailored guest article to ${prospect.domain}.`,
    "",
    `We already have a publication-ready draft fully completed and formatted to your style, featuring high-value insights for your audience.`,
    customNote ? `\nNote: ${customNote}\n` : null,
    `If your editorial process allows, we’d be grateful if your team could publish the article. Otherwise, please reply with your permission for us to submit it and any submission instructions or contributor access requirements. We will only submit it after receiving your approval.`,
    "",
    `Best regards,`,
    `${brandName} | ${campaign?.target_url || ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const gmailUser = process.env["GMAIL_USER"]?.trim() ?? "";
  const gmailPass = (process.env["GMAIL_APP_PASSWORD"] ?? "").replace(/\s+/g, "");
  if (!gmailUser || !gmailPass) {
    throw new Error("Configure GMAIL_USER and GMAIL_APP_PASSWORD before sending follow-ups.");
  }

  let emailId: string | null = null;
  let provider: "gmail" | "resend" | "local" = "gmail";

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailPass },
      });

      const htmlBody = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;line-height:1.6;font-size:14px">
          <p>Hi Editor,</p>
          <p>I wanted to quickly follow up on my previous note regarding contributing a tailored guest article to <strong>${prospect.domain}</strong>.</p>
          <p>We already have a publication-ready draft completed and formatted to your style, featuring actionable insights for your audience.</p>
          ${customNote ? `<p style="padding:10px 14px;background:#f8fafc;border-left:3px solid #3b82f6;margin:14px 0">${customNote}</p>` : ""}
          <p>${escapeHtml(PUBLICATION_PERMISSION_REQUEST)}</p>
          <p>Best regards,<br/><strong>${brandName}</strong><br/><span style="color:#64748b;font-size:12px">${campaign?.target_url || ""}</span></p>
        </div>
      `;

      const info = await transporter.sendMail({
        from: `"${gmailUser.split("@")[0]}" <${gmailUser}>`,
        to: prospect.contact_email,
        subject: followUpSubject,
        text: defaultBody,
        html: htmlBody,
      });

      emailId = info.messageId || `gmail_followup_${Date.now()}`;
      provider = "gmail";
      console.log(`[Gmail SMTP] Sent follow-up to ${prospect.contact_email}`);
    } catch (err) {
      const details = formatEmailError(err);
      console.error("[Gmail SMTP Follow-up Error]:", details);
      throw new Error(`The follow-up email could not be sent through Gmail: ${details}`);
    }
  }

  if (!emailId) {
    throw new Error("Gmail did not return a message ID for the follow-up email.");
  }

  await db
    .insert(outreach_logs)
    .values({
      prospect_id: prospectId,
      subject: followUpSubject,
      body: defaultBody,
      resend_email_id: emailId,
    })
    .run();

  return { sent: true, emailId, provider };
}

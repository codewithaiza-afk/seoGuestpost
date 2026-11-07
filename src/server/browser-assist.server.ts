import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { browser_sessions, prospects } from "../../drizzle/schema";
import { normalizeSubmissionUrl } from "@/lib/submission-url";
import { db } from "@/server/database";
import { getOwnedProspect } from "@/server/owned-records";

type BrowserTarget = "submission" | "login" | "signup";

type BrowserField = {
  label: string;
  type: string;
  required: boolean;
  manualOnly: boolean;
  controlIndex: number;
  formIndex: number;
};

type BrowserSession = {
  context: BrowserContext;
  page: Page;
  userId: string;
  prospectId: string;
};

export type BrowserInspection = {
  url: string;
  title: string;
  submissionFormDetected: boolean;
  manualVerificationRequired: boolean;
  fields: Omit<BrowserField, "controlIndex" | "formIndex">[];
};

export type BrowserFillResult = {
  filledFields: string[];
  requiredFieldsToComplete: string[];
  manualVerificationRequired: boolean;
};

export type BrowserSubmissionResult = {
  confirmationDetected: boolean;
  resultUrl: string | null;
  reference: string | null;
};

type ArticleFormContent = {
  title: string;
  content: string;
  authorName: string;
  authorEmail: string;
  authorBio: string;
  backlinkUrl: string;
};

const activeSessions = new Map<string, BrowserSession>();
const activeSubmissions = new Set<string>();
let browserInstance: Browser | undefined;

function sessionKey(userId: string, prospectId: string): string {
  return `${userId}:${prospectId}`;
}

function getEncryptionKey(): Buffer {
  const secret = process.env["BROWSER_SESSION_ENCRYPTION_KEY"]?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "Set BROWSER_SESSION_ENCRYPTION_KEY to a persistent random secret of at least 32 characters before saving browser sessions.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

function encryptSessionState(state: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(state, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptSessionState(value: string): string {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body)
    throw new Error("Stored browser session has an invalid encrypted format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function assertLocalBrowserHost(): void {
  if (process.env["NODE_ENV"] !== "production") return;
  const configuredBaseUrl = process.env["APP_BASE_URL"]?.trim();
  if (!configuredBaseUrl) {
    throw new Error("Set APP_BASE_URL to localhost to use local Playwright browser assistance.");
  }
  const hostname = new URL(configuredBaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(
      "Playwright opens a browser on the app server. Browser assistance is only available when the app is running locally on your computer.",
    );
  }
}

async function getBrowser(): Promise<Browser> {
  assertLocalBrowserHost();
  if (browserInstance?.isConnected()) return browserInstance;
  try {
    browserInstance = await chromium.launch({ headless: false });
    browserInstance.on("disconnected", () => {
      browserInstance = undefined;
      activeSessions.clear();
    });
    return browserInstance;
  } catch (error) {
    throw new Error(
      `Could not launch Playwright Chromium. Install it with "npx playwright install chromium" and run the app in a desktop session. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}

async function persistSession(session: BrowserSession): Promise<void> {
  const state = await session.context.storageState();
  const url = session.page.url();
  const encryptedState = encryptSessionState(JSON.stringify(state));
  const updatedAt = new Date().toISOString();
  await db
    .insert(browser_sessions)
    .values({
      user_id: session.userId,
      prospect_id: session.prospectId,
      storage_state_encrypted: encryptedState,
      last_url: url,
      updated_at: updatedAt,
    })
    .onConflictDoUpdate({
      target: browser_sessions.prospect_id,
      set: {
        user_id: session.userId,
        storage_state_encrypted: encryptedState,
        last_url: url,
        updated_at: updatedAt,
      },
    })
    .run();
}

function trackSession(session: BrowserSession): void {
  const save = () => {
    void persistSession(session).catch((error: unknown) => {
      console.error(
        `[browser-assist] Could not persist session for prospect ${session.prospectId}:`,
        error instanceof Error ? error.message : error,
      );
    });
  };
  session.page.on("framenavigated", (frame) => {
    if (frame === session.page.mainFrame()) save();
  });
  session.page.on("close", save);
}

async function createSession(userId: string, prospectId: string): Promise<BrowserSession> {
  const key = sessionKey(userId, prospectId);
  const existing = activeSessions.get(key);
  if (existing && !existing.page.isClosed()) return existing;

  const stored = await db
    .select()
    .from(browser_sessions)
    .where(and(eq(browser_sessions.user_id, userId), eq(browser_sessions.prospect_id, prospectId)))
    .get();
  const storageState = stored
    ? JSON.parse(decryptSessionState(stored.storage_state_encrypted))
    : undefined;
  const context = await (await getBrowser()).newContext({ storageState });
  const page = await context.newPage();
  const session = { context, page, userId, prospectId };
  activeSessions.set(key, session);
  context.on("close", () => activeSessions.delete(key));
  trackSession(session);
  return session;
}

async function validateApprovedProspect(userId: string, campaignId: string, prospectId: string) {
  const prospect = await getOwnedProspect(userId, campaignId, prospectId);
  if (!prospect) throw new Error("Prospect not found.");
  if (!prospect.submission_approved) {
    throw new Error("Approve this prospect's submission page before opening browser assistance.");
  }
  return prospect;
}

export async function openProspectBrowser(
  userId: string,
  campaignId: string,
  prospectId: string,
  target: BrowserTarget,
): Promise<{ url: string; restoredSession: boolean }> {
  const prospect = await validateApprovedProspect(userId, campaignId, prospectId);
  getEncryptionKey();
  const storedUrl =
    target === "submission"
      ? prospect.submission_url
      : target === "login"
        ? prospect.login_url
        : prospect.signup_url;
  if (!storedUrl) throw new Error(`No discovered ${target} page is available for this prospect.`);
  const url = normalizeSubmissionUrl(storedUrl, prospect.domain);
  const restoredSession = await db
    .select({ id: browser_sessions.id })
    .from(browser_sessions)
    .where(and(eq(browser_sessions.user_id, userId), eq(browser_sessions.prospect_id, prospectId)))
    .get();
  const session = await createSession(userId, prospectId);
  await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await persistSession(session);

  const status =
    target === "login"
      ? "Login Required"
      : target === "signup"
        ? "Signup Required"
        : "Manual Action Required";
  await db
    .update(prospects)
    .set({ workflow_status: status })
    .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
    .run();
  return { url, restoredSession: Boolean(restoredSession) };
}

async function requireActiveSession(userId: string, prospectId: string): Promise<BrowserSession> {
  const session = activeSessions.get(sessionKey(userId, prospectId));
  if (!session || session.page.isClosed()) {
    throw new Error("Open the prospect's guided browser first, then retry this action.");
  }
  return session;
}

async function inspectPage(
  page: Page,
): Promise<{ fields: BrowserField[]; title: string; url: string }> {
  const fields = await page
    .locator("input:not([type=hidden]), textarea, select, [contenteditable=true]")
    .evaluateAll((controls) =>
      controls.map((control, controlIndex) => {
        const element = control as HTMLInputElement;
        const labels = element.labels
          ? Array.from(element.labels).map((label) => label.innerText.trim())
          : [];
        const nearbyLabel =
          control.closest("label")?.textContent?.trim() ??
          control.getAttribute("aria-label") ??
          control.getAttribute("placeholder") ??
          "";
        const label =
          labels.join(" ").trim() ||
          nearbyLabel ||
          element.name ||
          element.id ||
          `Field ${controlIndex + 1}`;
        const type =
          element.getAttribute("type") ??
          (control.tagName.toLowerCase() === "textarea"
            ? "textarea"
            : control.getAttribute("contenteditable") === "true"
              ? "contenteditable"
              : control.tagName.toLowerCase());
        const formIndex = Array.from(document.forms).indexOf(
          control.closest("form") as HTMLFormElement,
        );
        const manualOnly =
          /password|captcha|security|verification|verify|one.?time|otp|code/i.test(
            `${label} ${type} ${element.name} ${element.id}`,
          ) || ["password", "file", "checkbox", "radio"].includes(type.toLowerCase());
        return {
          label: label.slice(0, 120),
          type: type.slice(0, 40),
          required: element.required || element.getAttribute("aria-required") === "true",
          manualOnly,
          controlIndex,
          formIndex,
        };
      }),
    );
  return { fields, title: await page.title(), url: page.url() };
}

function requiresManualVerification(fields: BrowserField[]): boolean {
  return fields.some((field) =>
    /captcha|security|verification|verify|one.?time|otp/i.test(`${field.label} ${field.type}`),
  );
}

async function pageRequiresManualVerification(
  page: Page,
  fields: BrowserField[],
): Promise<boolean> {
  if (requiresManualVerification(fields)) return true;
  return (
    (await page
      .locator('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]')
      .count()) > 0
  );
}

export function isGuestSubmissionForm(
  title: string,
  fields: Pick<BrowserField, "label" | "manualOnly">[],
): boolean {
  const pageLooksLikeSubmission = /write for us|guest post|submit (an )?article|contributor/i.test(
    title,
  );
  const hasArticleTitle = fields.some(
    (field) =>
      /article|post/.test(field.label.toLowerCase()) && /title/.test(field.label.toLowerCase()),
  );
  const hasArticleContent = fields.some(
    (field) =>
      !field.manualOnly &&
      ((/article|post|draft/.test(field.label.toLowerCase()) &&
        /content|body|text|draft/.test(field.label.toLowerCase())) ||
        (pageLooksLikeSubmission && /^(content|body|article|post)$/i.test(field.label.trim()))),
  );
  return hasArticleContent && (hasArticleTitle || pageLooksLikeSubmission);
}

export async function inspectProspectBrowser(
  userId: string,
  campaignId: string,
  prospectId: string,
): Promise<BrowserInspection> {
  const prospect = await validateApprovedProspect(userId, campaignId, prospectId);
  const session = await requireActiveSession(userId, prospectId);
  if (!prospect.submission_url) {
    throw new Error("No approved submission page is saved for this prospect.");
  }
  const submissionUrl = normalizeSubmissionUrl(prospect.submission_url, prospect.domain);
  const currentUrl = new URL(session.page.url());
  const expectedUrl = new URL(submissionUrl);
  if (
    currentUrl.origin !== expectedUrl.origin ||
    currentUrl.pathname.replace(/\/+$/, "") !== expectedUrl.pathname.replace(/\/+$/, "")
  ) {
    await persistSession(session);
    await session.page.goto(submissionUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  const inspection = await inspectPage(session.page);
  const submissionFormDetected = isGuestSubmissionForm(inspection.title, inspection.fields);
  const manualVerificationRequired = await pageRequiresManualVerification(
    session.page,
    inspection.fields,
  );
  await persistSession(session);
  await db
    .update(prospects)
    .set({
      workflow_status: submissionFormDetected
        ? "Submission Form Detected"
        : "Manual Action Required",
    })
    .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
    .run();
  return {
    ...inspection,
    submissionFormDetected,
    manualVerificationRequired,
    fields: inspection.fields.map(
      ({ controlIndex: _controlIndex, formIndex: _formIndex, ...field }) => field,
    ),
  };
}

function mapArticleField(label: string, type: string, article: ArticleFormContent): string | null {
  const normalized = label
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[*:]+$/g, "")
    .trim();
  if (/article title|post title|title of (the )?(article|post)/.test(normalized))
    return article.title;
  if (
    /article (content|body|text|draft)|post (content|body|text)|content of (the )?(article|post)/.test(
      normalized,
    )
  ) {
    return article.content;
  }
  if (/author (name|full name)|your name|full name|^name$/.test(normalized))
    return article.authorName;
  if (/author email|your email|email address|^email$/.test(normalized)) return article.authorEmail;
  if (/author bio|biography|about the author/.test(normalized)) return article.authorBio;
  if (/backlink|external link|your website|website url|site url/.test(normalized)) {
    return article.backlinkUrl;
  }
  if (type === "url" && /website|link/.test(normalized)) return article.backlinkUrl;
  return null;
}

export async function fillProspectSubmissionForm(
  userId: string,
  campaignId: string,
  prospectId: string,
  article: ArticleFormContent,
): Promise<BrowserFillResult> {
  await validateApprovedProspect(userId, campaignId, prospectId);
  const session = await requireActiveSession(userId, prospectId);
  const inspection = await inspectPage(session.page);
  if (!isGuestSubmissionForm(inspection.title, inspection.fields)) {
    throw new Error(
      "No recognizable article submission form was detected. This page may require manual submission or email outreach.",
    );
  }

  const filledFields: string[] = [];
  const requiredFieldsToComplete: string[] = [];
  const controls = session.page.locator(
    "input:not([type=hidden]), textarea, select, [contenteditable=true]",
  );
  for (const field of inspection.fields) {
    if (field.manualOnly) {
      if (field.required) requiredFieldsToComplete.push(field.label);
      continue;
    }
    const value = ["select", "file"].includes(field.type.toLowerCase())
      ? null
      : mapArticleField(field.label, field.type, article);
    if (value) {
      await controls.nth(field.controlIndex).fill(value);
      filledFields.push(field.label);
    } else if (field.required) {
      requiredFieldsToComplete.push(field.label);
    }
  }

  await persistSession(session);
  await db
    .update(prospects)
    .set({ workflow_status: "Awaiting Final Approval" })
    .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
    .run();
  return {
    filledFields,
    requiredFieldsToComplete,
    manualVerificationRequired: requiresManualVerification(inspection.fields),
  };
}

export async function submitProspectBrowserForm(
  userId: string,
  campaignId: string,
  prospectId: string,
  finalApproval: boolean,
  manualVerificationCompleted: boolean,
): Promise<BrowserSubmissionResult> {
  if (!finalApproval) throw new Error("Final article approval is required before submission.");
  const prospect = await validateApprovedProspect(userId, campaignId, prospectId);
  if (prospect.submission_completed_at || prospect.submission_attempted_at) {
    throw new Error(
      "A submission was already recorded or attempted for this prospect. Check the browser and campaign status before trying again.",
    );
  }
  const key = sessionKey(userId, prospectId);
  if (activeSubmissions.has(key)) throw new Error("A submission is already in progress.");

  const session = await requireActiveSession(userId, prospectId);
  const inspection = await inspectPage(session.page);
  if (!isGuestSubmissionForm(inspection.title, inspection.fields)) {
    throw new Error("No recognized article submission form is open in the guided browser.");
  }
  if (
    (await pageRequiresManualVerification(session.page, inspection.fields)) &&
    !manualVerificationCompleted
  ) {
    throw new Error("Complete the website's CAPTCHA or security check in the browser first.");
  }

  const articleFields = inspection.fields.filter((field) =>
    /article|post|draft/.test(field.label.toLowerCase()),
  );
  const formIndexes = new Set(
    articleFields.map((field) => field.formIndex).filter((index) => index >= 0),
  );
  if (formIndexes.size !== 1) {
    throw new Error(
      "Could not identify one unambiguous article form. Submit it manually in the browser.",
    );
  }
  const formIndex = [...formIndexes][0];
  if (formIndex === undefined) throw new Error("The article form is unavailable.");
  const form = session.page.locator("form").nth(formIndex);
  const submitButtons = form.locator(
    'button:not([type]), button[type="submit"], input[type="submit"]',
  );
  if ((await submitButtons.count()) !== 1) {
    throw new Error(
      "Could not identify one safe submit button. Complete submission manually in the browser.",
    );
  }
  if (!(await form.evaluate((element) => (element as HTMLFormElement).checkValidity()))) {
    throw new Error("Complete all required fields in the browser before approving submission.");
  }

  const attemptedAt = new Date().toISOString();
  const claim = await db
    .update(prospects)
    .set({ submission_attempted_at: attemptedAt, workflow_status: "Awaiting Final Approval" })
    .where(
      and(
        eq(prospects.id, prospectId),
        eq(prospects.campaign_id, campaignId),
        isNull(prospects.submission_attempted_at),
        isNull(prospects.submission_completed_at),
      ),
    )
    .run();
  if (claim.rowsAffected === 0) throw new Error("A submission attempt was already recorded.");

  activeSubmissions.add(key);
  try {
    const navigation = session.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8_000 })
      .catch(() => null);
    await submitButtons.click({ timeout: 10_000 });
    await navigation;
    const pageText = await session.page.locator("body").innerText({ timeout: 5_000 });
    const confirmationDetected =
      /\b(thank you|successfully submitted|submission received|we have received|we've received|awaiting (?:editorial )?review|pending editorial review)\b/i.test(
        pageText,
      );
    const reference =
      pageText.match(
        /(?:submission|reference|ticket|confirmation)\s*(?:id|number|reference)?\s*(?:is|#|:)\s*([A-Z0-9-]{5,})/i,
      )?.[1] ?? null;
    let resultUrl: string | null = null;
    try {
      resultUrl = normalizeSubmissionUrl(session.page.url(), prospect.domain);
    } catch {
      resultUrl = null;
    }

    await db
      .update(prospects)
      .set({
        submission_completed_at: confirmationDetected ? new Date().toISOString() : null,
        submission_result_url: resultUrl,
        submission_reference: reference,
        workflow_status: confirmationDetected
          ? "Pending Editorial Review"
          : "Manual Action Required",
      })
      .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
      .run();
    await persistSession(session);
    return { confirmationDetected, resultUrl, reference };
  } catch (error) {
    await db
      .update(prospects)
      .set({ workflow_status: "Manual Action Required" })
      .where(and(eq(prospects.id, prospectId), eq(prospects.campaign_id, campaignId)))
      .run();
    throw new Error(
      `The website submission may have been sent. Check the guided browser and confirmation before any retry. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  } finally {
    activeSubmissions.delete(key);
  }
}

export async function closeProspectBrowser(userId: string, prospectId: string): Promise<void> {
  const session = activeSessions.get(sessionKey(userId, prospectId));
  if (!session) return;
  await persistSession(session);
  await session.context.close();
}

export const browserSessionEncryption = {
  encrypt: encryptSessionState,
  decrypt: decryptSessionState,
};

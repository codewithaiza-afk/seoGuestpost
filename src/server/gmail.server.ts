import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  campaigns,
  gmail_connections,
  gmail_oauth_states,
  inbound_email_replies,
  outreach_logs,
  prospects,
} from "../../drizzle/schema";
import { db } from "@/server/database";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];
const MAX_REPLY_BODY_LENGTH = 10_000;
let replyPollingStarted = false;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailPart[] };
};

export type InboundReply = {
  id: string;
  sender: string;
  subject: string;
  body_text: string;
  classification: "positive" | "negative" | "neutral";
  received_at: string;
};

function getOAuthConfig() {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();
  const appBaseUrl = process.env["APP_BASE_URL"]?.trim();
  if (!clientId || !clientSecret || !appBaseUrl) {
    throw new Error(
      "Gmail inbox connection is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and APP_BASE_URL in the local environment.",
    );
  }
  const baseUrl = new URL(appBaseUrl);
  if (process.env["NODE_ENV"] === "production" && baseUrl.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: new URL("/api/gmail/callback", baseUrl).toString(),
  };
}

function getEncryptionKey(): Buffer {
  const secret = process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"]?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "Set GOOGLE_TOKEN_ENCRYPTION_KEY to a randomly generated secret of at least 32 characters before connecting Gmail.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptRefreshToken(encryptedToken: string): string {
  const [iv, tag, body] = encryptedToken.split(".");
  if (!iv || !tag || !body) throw new Error("Stored Gmail token has an invalid encrypted format.");
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

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

export function classifyEditorReply(subject: string, body: string): InboundReply["classification"] {
  const content = `${subject} ${body}`.toLowerCase();
  if (
    /\b(not interested|not accepting|cannot accept|can't accept|decline|reject(?:ed)?|paid only|payment required|no guest posts)\b/.test(
      content,
    )
  ) {
    return "negative";
  }
  if (
    /\b(approved|accept(?:ed|ance)?|happy to publish|go ahead|send (?:the )?(?:full )?draft|please submit|we can publish|we'd love to publish)\b/.test(
      content,
    )
  ) {
    return "positive";
  }
  return "neutral";
}

export async function createGmailAuthorizationUrl(
  userId: string,
  requestedReturnPath?: string,
): Promise<string> {
  const { clientId, redirectUri } = getOAuthConfig();
  getEncryptionKey();
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const returnPath =
    requestedReturnPath && /^\/campaigns\/[a-f\d-]+$/i.test(requestedReturnPath)
      ? requestedReturnPath
      : "/campaigns";

  await db
    .delete(gmail_oauth_states)
    .where(sql`${gmail_oauth_states.expires_at} < ${new Date().toISOString()}`)
    .run();
  await db
    .insert(gmail_oauth_states)
    .values({
      state_hash: createHash("sha256").update(state).digest("hex"),
      user_id: userId,
      code_verifier: verifier,
      return_path: returnPath,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    .run();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function postGoogleToken(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(
      result.error_description ??
        result.error ??
        `Google token request failed (${response.status}).`,
    );
  }
  return result;
}

export async function finishGmailAuthorization(state: string, code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const stateHash = createHash("sha256").update(state).digest("hex");
  const savedState = await db
    .select()
    .from(gmail_oauth_states)
    .where(
      and(
        eq(gmail_oauth_states.state_hash, stateHash),
        sql`${gmail_oauth_states.expires_at} > ${new Date().toISOString()}`,
      ),
    )
    .get();
  await db.delete(gmail_oauth_states).where(eq(gmail_oauth_states.state_hash, stateHash)).run();
  if (!savedState)
    throw new Error("Gmail authorization expired or the security state did not match.");

  const token = await postGoogleToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: savedState.code_verifier,
    }),
  );
  if (!token.access_token || !token.refresh_token) {
    throw new Error(
      "Google did not return an offline refresh token. Reconnect and approve access again.",
    );
  }

  const profileResponse = await fetch(`${GMAIL_API_URL}/profile`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const profile = (await profileResponse.json()) as { emailAddress?: string };
  if (!profileResponse.ok || !profile.emailAddress) {
    throw new Error("Could not verify the connected Gmail address.");
  }
  const configuredSender = process.env["GMAIL_USER"]?.trim().toLowerCase();
  if (configuredSender && profile.emailAddress.toLowerCase() !== configuredSender) {
    throw new Error("Connect the same Gmail account configured as GMAIL_USER for outgoing emails.");
  }

  await db
    .insert(gmail_connections)
    .values({
      user_id: savedState.user_id,
      connected_email: profile.emailAddress.toLowerCase(),
      refresh_token_encrypted: encryptRefreshToken(token.refresh_token),
      last_checked_at: null,
    })
    .onConflictDoUpdate({
      target: gmail_connections.user_id,
      set: {
        connected_email: profile.emailAddress.toLowerCase(),
        refresh_token_encrypted: encryptRefreshToken(token.refresh_token),
        last_checked_at: null,
      },
    })
    .run();
  return savedState.return_path;
}

export async function getGmailConnection(userId: string) {
  const connection = await db
    .select({
      email: gmail_connections.connected_email,
      lastCheckedAt: gmail_connections.last_checked_at,
    })
    .from(gmail_connections)
    .where(eq(gmail_connections.user_id, userId))
    .get();
  return connection ?? null;
}

export async function disconnectGmail(userId: string): Promise<void> {
  const connection = await db
    .select({ refreshToken: gmail_connections.refresh_token_encrypted })
    .from(gmail_connections)
    .where(eq(gmail_connections.user_id, userId))
    .get();
  if (!connection) return;

  let revokeError: string | null = null;
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: decryptRefreshToken(connection.refreshToken),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) revokeError = `Google token revocation failed (${response.status}).`;
  } catch (error) {
    revokeError = error instanceof Error ? error.message : "Google token revocation failed.";
  }

  await db.delete(gmail_connections).where(eq(gmail_connections.user_id, userId)).run();
  if (revokeError) {
    throw new Error(
      `The inbox was disconnected locally, but Google could not confirm token revocation. Revoke LinkForge from your Google Account security page. (${revokeError})`,
    );
  }
}

export function startGmailReplyPolling(): void {
  if (replyPollingStarted || process.env["NODE_ENV"] === "test") return;
  replyPollingStarted = true;

  let running = false;
  const syncAllCampaigns = async () => {
    if (running) return;
    running = true;
    try {
      await syncAllGmailReplies();
    } catch (error) {
      console.error(
        "[gmail-reply-sync] Scheduled mailbox scan failed:",
        error instanceof Error ? error.message : "Unknown inbox sync error",
      );
    } finally {
      running = false;
    }
  };

  void syncAllCampaigns();
  const interval = setInterval(() => void syncAllCampaigns(), 15 * 60 * 1000);
  interval.unref();
}

export async function syncAllGmailReplies(): Promise<{
  campaignsChecked: number;
  campaignsFailed: number;
  newReplies: number;
}> {
  const activeCampaigns = await db
    .select({
      userId: gmail_connections.user_id,
      campaignId: campaigns.id,
    })
    .from(gmail_connections)
    .innerJoin(campaigns, eq(campaigns.user_id, gmail_connections.user_id))
    .innerJoin(prospects, eq(prospects.campaign_id, campaigns.id))
    .where(
      and(inArray(prospects.status, ["Pitched", "Replied"]), isNotNull(prospects.contact_email)),
    )
    .groupBy(gmail_connections.user_id, campaigns.id)
    .limit(100)
    .all();

  let campaignsFailed = 0;
  let newReplies = 0;
  for (const activeCampaign of activeCampaigns) {
    try {
      const result = await syncCampaignReplies(activeCampaign.userId, activeCampaign.campaignId);
      newReplies += result.newReplies;
    } catch (error) {
      campaignsFailed += 1;
      console.error(
        `[gmail-reply-sync] Campaign ${activeCampaign.campaignId} failed:`,
        error instanceof Error ? error.message : "Unknown inbox sync error",
      );
    }
  }
  return { campaignsChecked: activeCampaigns.length, campaignsFailed, newReplies };
}

async function getGmailAccessToken(userId: string): Promise<string> {
  const connection = await db
    .select()
    .from(gmail_connections)
    .where(eq(gmail_connections.user_id, userId))
    .get();
  if (!connection) throw new Error("Connect Gmail to check editor replies.");
  const { clientId, clientSecret } = getOAuthConfig();
  const token = await postGoogleToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptRefreshToken(connection.refresh_token_encrypted),
      grant_type: "refresh_token",
    }),
  );
  if (!token.access_token) throw new Error("Google did not return an access token.");
  return token.access_token;
}

async function gmailRequest<T>(accessToken: string, url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gmail API request failed (${response.status}).`);
  }
  return payload;
}

function decodeMessagePart(part: GmailPart): string[] {
  const content =
    part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")
      ? [Buffer.from(part.body.data, "base64url").toString("utf8")]
      : [];
  return [...content, ...(part.parts ?? []).flatMap(decodeMessagePart)];
}

function extractMessageBody(message: GmailMessage): string {
  const parts: GmailPart[] = message.payload ? [message.payload] : [];
  const textParts = parts.flatMap(decodeMessagePart);
  const plainText = textParts.find((part) => !/<[a-z][\s\S]*>/i.test(part)) ?? textParts[0] ?? "";
  return plainText
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REPLY_BODY_LENGTH);
}

function getHeader(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function parseSender(value: string): string | null {
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return email?.toLowerCase() ?? null;
}

export async function syncCampaignReplies(
  userId: string,
  campaignId: string,
): Promise<{ checked: number; newReplies: number }> {
  const campaign = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.user_id, userId)))
    .get();
  if (!campaign) throw new Error("Campaign not found.");

  const accessToken = await getGmailAccessToken(userId);
  const targets = await db
    .select({
      id: prospects.id,
      contactEmail: prospects.contact_email,
      status: prospects.status,
    })
    .from(prospects)
    .where(
      and(
        eq(prospects.campaign_id, campaignId),
        inArray(prospects.status, ["Pitched", "Replied"]),
        sql`${prospects.contact_email} is not null`,
      ),
    )
    .limit(50)
    .all();

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  let newReplies = 0;
  for (const target of targets) {
    if (!target.contactEmail) continue;
    const sentAt = (
      await db
        .select({ lastSentAt: sql<string>`max(${outreach_logs.sent_at})` })
        .from(outreach_logs)
        .where(eq(outreach_logs.prospect_id, target.id))
        .get()
    )?.lastSentAt;
    if (!sentAt) continue;
    const after = Math.max(0, Math.floor(new Date(sentAt).getTime() / 1000) - 60);
    let pageToken: string | undefined;
    let pageCount = 0;
    do {
      const search = new URL(`${GMAIL_API_URL}/messages`);
      search.searchParams.set(
        "q",
        `from:${target.contactEmail} after:${after} before:${nowEpochSeconds}`,
      );
      search.searchParams.set("maxResults", "100");
      if (pageToken) search.searchParams.set("pageToken", pageToken);
      const list = await gmailRequest<{
        messages?: { id: string }[];
        nextPageToken?: string;
      }>(accessToken, search);
      const messageIds = (list.messages ?? []).map((message) => message.id);
      const knownIds =
        messageIds.length > 0
          ? new Set(
              (
                await db
                  .select({ id: inbound_email_replies.gmail_message_id })
                  .from(inbound_email_replies)
                  .where(inArray(inbound_email_replies.gmail_message_id, messageIds))
                  .all()
              ).map((reply) => reply.id),
            )
          : new Set<string>();

      for (const item of list.messages ?? []) {
        if (knownIds.has(item.id)) continue;
        const messageUrl = new URL(`${GMAIL_API_URL}/messages/${encodeURIComponent(item.id)}`);
        messageUrl.searchParams.set("format", "full");
        const message = await gmailRequest<GmailMessage>(accessToken, messageUrl);
        if (!message.id || !message.internalDate) continue;

        const sender = parseSender(getHeader(message, "from"));
        if (!sender || sender !== target.contactEmail.toLowerCase()) continue;
        const receivedAt = new Date(Number(message.internalDate)).toISOString();
        if (new Date(receivedAt).getTime() < new Date(sentAt).getTime()) continue;

        const subject = getHeader(message, "subject") || "(no subject)";
        const bodyText = extractMessageBody(message) || message.snippet || "";
        const classification = classifyEditorReply(subject, bodyText);
        const inserted = await db
          .insert(inbound_email_replies)
          .values({
            prospect_id: target.id,
            gmail_message_id: message.id,
            sender,
            subject: subject.slice(0, 1000),
            body_text: bodyText,
            classification,
            received_at: receivedAt,
          })
          .onConflictDoNothing({ target: inbound_email_replies.gmail_message_id })
          .run();
        if (inserted.rowsAffected === 0) continue;

        await db
          .update(prospects)
          .set({
            status: "Replied",
            workflow_status:
              classification === "positive" ? "Awaiting Final Approval" : "Email Outreach",
          })
          .where(eq(prospects.id, target.id))
          .run();
        newReplies += 1;
      }

      pageToken = list.nextPageToken;
      pageCount += 1;
    } while (pageToken && pageCount < 5);
    if (pageToken) {
      console.warn(
        `[gmail-reply-sync] Reply listing reached its 500-message cap for prospect ${target.id}.`,
      );
    }
  }

  await db
    .update(gmail_connections)
    .set({ last_checked_at: new Date().toISOString() })
    .where(eq(gmail_connections.user_id, userId))
    .run();
  return { checked: targets.length, newReplies };
}

export async function listProspectReplies(
  userId: string,
  prospectId: string,
): Promise<InboundReply[]> {
  const ownedProspect = await db
    .select({ id: prospects.id })
    .from(prospects)
    .innerJoin(campaigns, eq(campaigns.id, prospects.campaign_id))
    .where(and(eq(prospects.id, prospectId), eq(campaigns.user_id, userId)))
    .get();
  if (!ownedProspect) throw new Error("Prospect not found.");
  const replies = await db
    .select({
      id: inbound_email_replies.id,
      sender: inbound_email_replies.sender,
      subject: inbound_email_replies.subject,
      body_text: inbound_email_replies.body_text,
      classification: inbound_email_replies.classification,
      received_at: inbound_email_replies.received_at,
    })
    .from(inbound_email_replies)
    .where(eq(inbound_email_replies.prospect_id, prospectId))
    .orderBy(desc(inbound_email_replies.received_at))
    .all();
  return replies;
}

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    email: text("email").notNull(),
    password_hash: text("password_hash").notNull(),
    full_name: text("full_name"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const user_sessions = sqliteTable(
  "user_sessions",
  {
    token_hash: text("token_hash").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: text("expires_at").notNull(),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [index("user_sessions_user_id_idx").on(table.user_id)],
);

export const gmail_connections = sqliteTable(
  "gmail_connections",
  {
    user_id: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    connected_email: text("connected_email").notNull(),
    refresh_token_encrypted: text("refresh_token_encrypted").notNull(),
    last_checked_at: text("last_checked_at"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [uniqueIndex("gmail_connections_email_unique").on(table.connected_email)],
);

export const gmail_oauth_states = sqliteTable(
  "gmail_oauth_states",
  {
    state_hash: text("state_hash").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code_verifier: text("code_verifier").notNull(),
    return_path: text("return_path").notNull().default("/campaigns"),
    expires_at: text("expires_at").notNull(),
  },
  (table) => [index("gmail_oauth_states_expiry_idx").on(table.expires_at)],
);

export const password_resets = sqliteTable(
  "password_resets",
  {
    token_hash: text("token_hash").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: text("expires_at").notNull(),
    used_at: text("used_at"),
  },
  (table) => [index("password_resets_user_id_idx").on(table.user_id)],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    target_url: text("target_url").notNull(),
    target_anchor: text("target_anchor").notNull(),
    niche: text("niche").notNull(),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [index("campaigns_user_created_idx").on(table.user_id, table.created_at)],
);

export const prospects = sqliteTable(
  "prospects",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    campaign_id: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    contact_email: text("contact_email"),
    da_dr_score: integer("da_dr_score").notNull().default(0),
    status: text("status")
      .$type<"Discovered" | "Pitched" | "Replied" | "Live" | "Rejected">()
      .notNull()
      .default("Discovered"),
    live_backlink_url: text("live_backlink_url"),
    submission_url: text("submission_url"),
    submission_approved: integer("submission_approved", { mode: "boolean" })
      .notNull()
      .default(false),
    submission_completed_at: text("submission_completed_at"),
    submission_attempted_at: text("submission_attempted_at"),
    submission_result_url: text("submission_result_url"),
    submission_reference: text("submission_reference"),
    login_url: text("login_url"),
    signup_url: text("signup_url"),
    submission_details: text("submission_details", { mode: "json" })
      .$type<Json>()
      .notNull()
      .default([]),
    workflow_status: text("workflow_status").notNull().default("Discovered"),
    is_dofollow: integer("is_dofollow", { mode: "boolean" }).notNull().default(false),
    last_checked_at: text("last_checked_at"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    uniqueIndex("prospects_campaign_domain_unique").on(table.campaign_id, table.domain),
    index("prospects_campaign_created_idx").on(table.campaign_id, table.created_at),
    index("prospects_status_idx").on(table.status),
    check(
      "prospects_status_check",
      sql`${table.status} in ('Discovered', 'Pitched', 'Replied', 'Live', 'Rejected')`,
    ),
    check(
      "prospects_workflow_status_check",
      sql`${table.workflow_status} in (
        'Discovered', 'Awaiting Approval', 'Approved', 'Login Required',
        'Signup Required', 'Authenticated', 'Submission Form Detected',
        'Article Prepared', 'Awaiting Final Approval', 'Submitted',
        'Pending Editorial Review', 'Published', 'Submission Verified',
        'Email Outreach', 'Rejected', 'Failed', 'Manual Action Required'
      )`,
    ),
  ],
);

export const browser_sessions = sqliteTable(
  "browser_sessions",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prospect_id: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    storage_state_encrypted: text("storage_state_encrypted").notNull(),
    last_url: text("last_url"),
    updated_at: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    uniqueIndex("browser_sessions_prospect_unique").on(table.prospect_id),
    index("browser_sessions_user_idx").on(table.user_id),
  ],
);

export const outreach_logs = sqliteTable(
  "outreach_logs",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    prospect_id: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    sent_at: text("sent_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    resend_email_id: text("resend_email_id"),
  },
  (table) => [index("outreach_logs_prospect_sent_idx").on(table.prospect_id, table.sent_at)],
);

export const inbound_email_replies = sqliteTable(
  "inbound_email_replies",
  {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    prospect_id: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    gmail_message_id: text("gmail_message_id").notNull(),
    sender: text("sender").notNull(),
    subject: text("subject").notNull(),
    body_text: text("body_text").notNull(),
    classification: text("classification").$type<"positive" | "negative" | "neutral">().notNull(),
    received_at: text("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("inbound_email_replies_message_unique").on(table.gmail_message_id),
    index("inbound_email_replies_prospect_date_idx").on(table.prospect_id, table.received_at),
  ],
);

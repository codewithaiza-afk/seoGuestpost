import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../drizzle/schema";

const isVercel = Boolean(process.env["VERCEL"]);
const databasePath = resolve(
  process.env["DATABASE_PATH"] ||
    (isVercel ? "/tmp/guest-posting.sqlite" : "./data/guest-posting.sqlite"),
);
const backupDirectory = resolve(
  process.env["DATABASE_BACKUP_DIR"] || join(dirname(databasePath), "backups"),
);
const remoteUrl = process.env["TURSO_DATABASE_URL"]?.trim();
const remoteAuthToken = process.env["TURSO_AUTH_TOKEN"]?.trim();
const usesRemoteDatabase = Boolean(remoteUrl && !remoteUrl.startsWith("file:"));

if (usesRemoteDatabase && !remoteAuthToken) {
  throw new Error("TURSO_AUTH_TOKEN must be configured when using a remote libSQL database.");
}

if (isVercel && !usesRemoteDatabase) {
  console.warn(
    "[database] TURSO_DATABASE_URL is not configured on Vercel. Using temporary fallback database at /tmp/guest-posting.sqlite. For persistent data across serverless cold starts, please add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel project settings.",
  );
}

const databaseUrl = remoteUrl || pathToFileURL(databasePath).href;
const isLocalDatabase = databaseUrl.startsWith("file:");
if (isLocalDatabase) {
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
  } catch (error) {
    console.warn("[database] Could not create database directory:", error);
  }
}

const client = createClient({
  url: databaseUrl,
  ...(remoteAuthToken ? { authToken: remoteAuthToken } : {}),
});
if (isLocalDatabase) await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });

async function initSchema(cl: typeof client): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      full_name text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);`,
    `CREATE TABLE IF NOT EXISTS campaigns (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      name text NOT NULL,
      target_url text NOT NULL,
      target_anchor text NOT NULL,
      niche text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE INDEX IF NOT EXISTS campaigns_user_created_idx ON campaigns (user_id, created_at);`,
    `CREATE TABLE IF NOT EXISTS prospects (
      id text PRIMARY KEY NOT NULL,
      campaign_id text NOT NULL,
      domain text NOT NULL,
      contact_email text,
      da_dr_score integer DEFAULT 0 NOT NULL,
      status text DEFAULT 'Discovered' NOT NULL,
      live_backlink_url text,
      submission_url text,
      submission_approved integer DEFAULT false NOT NULL,
      submission_completed_at text,
      login_url text,
      signup_url text,
      submission_details text DEFAULT '[]' NOT NULL,
      workflow_status text DEFAULT 'Discovered' NOT NULL,
      is_dofollow integer DEFAULT false NOT NULL,
      last_checked_at text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      submission_attempted_at text,
      submission_result_url text,
      submission_reference text,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS prospects_campaign_domain_unique ON prospects (campaign_id, domain);`,
    `CREATE INDEX IF NOT EXISTS prospects_campaign_created_idx ON prospects (campaign_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS prospects_status_idx ON prospects (status);`,
    `CREATE TABLE IF NOT EXISTS outreach_logs (
      id text PRIMARY KEY NOT NULL,
      prospect_id text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      sent_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      resend_email_id text,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE INDEX IF NOT EXISTS outreach_logs_prospect_sent_idx ON outreach_logs (prospect_id, sent_at);`,
    `CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      expires_at text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      token_hash text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      expires_at text NOT NULL,
      used_at text,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);`,
    `CREATE TABLE IF NOT EXISTS gmail_connections (
      user_id text PRIMARY KEY NOT NULL,
      connected_email text NOT NULL,
      refresh_token_encrypted text NOT NULL,
      last_checked_at text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS gmail_connections_email_unique ON gmail_connections (connected_email);`,
    `CREATE TABLE IF NOT EXISTS gmail_oauth_states (
      state_hash text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      code_verifier text NOT NULL,
      return_path text DEFAULT '/campaigns' NOT NULL,
      expires_at text NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE INDEX IF NOT EXISTS gmail_oauth_states_expiry_idx ON gmail_oauth_states (expires_at);`,
    `CREATE TABLE IF NOT EXISTS inbound_email_replies (
      id text PRIMARY KEY NOT NULL,
      prospect_id text NOT NULL,
      gmail_message_id text NOT NULL,
      sender text NOT NULL,
      subject text NOT NULL,
      body_text text NOT NULL,
      classification text NOT NULL,
      received_at text NOT NULL,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_replies_message_unique ON inbound_email_replies (gmail_message_id);`,
    `CREATE INDEX IF NOT EXISTS inbound_email_replies_prospect_date_idx ON inbound_email_replies (prospect_id, received_at);`,
    `CREATE TABLE IF NOT EXISTS browser_sessions (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      prospect_id text NOT NULL,
      storage_state_encrypted text NOT NULL,
      last_url text,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON UPDATE no action ON DELETE cascade
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS browser_sessions_prospect_unique ON browser_sessions (prospect_id);`,
    `CREATE INDEX IF NOT EXISTS browser_sessions_user_idx ON browser_sessions (user_id);`
  ];
  for (const statement of statements) {
    try {
      await cl.execute(statement);
    } catch (error) {
      console.warn("[database] Schema init statement warning:", error);
    }
  }

  const columnsToAdd = [
    "ALTER TABLE prospects ADD COLUMN submission_attempted_at text",
    "ALTER TABLE prospects ADD COLUMN submission_result_url text",
    "ALTER TABLE prospects ADD COLUMN submission_reference text"
  ];
  for (const colSql of columnsToAdd) {
    try {
      await cl.execute(colSql);
    } catch {
      // Column already exists, safe to ignore
    }
  }
}

const migrationsFolder = resolve(process.cwd(), "drizzle/sqlite-migrations");
if (existsSync(migrationsFolder)) {
  try {
    await migrate(db, { migrationsFolder });
  } catch (error) {
    console.warn("[database] Drizzle migrate failed, applying embedded schema:", error);
    await initSchema(client);
  }
} else {
  await initSchema(client);
}

if (isLocalDatabase) {
  const integrityResult = await client.execute("PRAGMA integrity_check");
  if (integrityResult.rows[0]?.["integrity_check"] !== "ok") {
    throw new Error(
      `SQLite integrity check failed: ${String(integrityResult.rows[0]?.["integrity_check"])}`,
    );
  }
  const foreignKeyViolations = await client.execute("PRAGMA foreign_key_check");
  if (foreignKeyViolations.rows.length > 0) {
    throw new Error(
      `SQLite has ${foreignKeyViolations.rows.length} foreign-key integrity violation(s).`,
    );
  }
}

export function closeDatabase(): void {
  client.close();
}

export async function createDatabaseBackup(destination?: string): Promise<string> {
  if (!isLocalDatabase) {
    throw new Error(
      "Remote database backups are managed by the database provider; this local backup command only supports file-based SQLite.",
    );
  }
  mkdirSync(backupDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const backupPath = resolve(destination || join(backupDirectory, `guest-posting-${date}.sqlite`));
  const escapedPath = backupPath.replace(/'/g, "''");
  await client.execute(`VACUUM INTO '${escapedPath}'`);

  const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(backupDirectory)) {
    if (!/^guest-posting-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)) continue;
    const path = join(backupDirectory, name);
    if (statSync(path).mtimeMs < retentionCutoff) {
      try {
        unlinkSync(path);
      } catch (error) {
        console.error(`[database] Could not remove expired backup ${path}`, error);
      }
    }
  }
  return backupPath;
}

if (isLocalDatabase && !isVercel) {
  const dailyBackupPath = join(
    backupDirectory,
    `guest-posting-${new Date().toISOString().slice(0, 10)}.sqlite`,
  );
  if (process.env["NODE_ENV"] !== "test" && !existsSync(dailyBackupPath)) {
    void createDatabaseBackup().catch((error: unknown) => {
      console.error("[database] Automatic daily backup failed", error);
    });
  }

  if (process.env["NODE_ENV"] !== "test") {
    const backupInterval = setInterval(
      () => {
        void createDatabaseBackup().catch((error: unknown) => {
          console.error("[database] Scheduled backup failed", error);
        });
      },
      24 * 60 * 60 * 1000,
    );
    backupInterval.unref();
  }
}

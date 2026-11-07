import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../drizzle/schema";

const databasePath = resolve(process.env["DATABASE_PATH"] || "./data/guest-posting.sqlite");
const backupDirectory = resolve(
  process.env["DATABASE_BACKUP_DIR"] || join(dirname(databasePath), "backups"),
);
const remoteUrl = process.env["TURSO_DATABASE_URL"]?.trim();
const remoteAuthToken = process.env["TURSO_AUTH_TOKEN"]?.trim();
const usesRemoteDatabase = Boolean(remoteUrl && !remoteUrl.startsWith("file:"));
if (process.env["VERCEL"] && process.env["NODE_ENV"] !== "test" && !usesRemoteDatabase) {
  throw new Error("TURSO_DATABASE_URL must be configured for Vercel deployments.");
}
if (usesRemoteDatabase && !remoteAuthToken) {
  throw new Error("TURSO_AUTH_TOKEN must be configured when using a remote libSQL database.");
}
const databaseUrl = remoteUrl || pathToFileURL(databasePath).href;
const isLocalDatabase = databaseUrl.startsWith("file:");
if (isLocalDatabase) mkdirSync(dirname(databasePath), { recursive: true });

const client = createClient({
  url: databaseUrl,
  ...(remoteAuthToken ? { authToken: remoteAuthToken } : {}),
});
if (isLocalDatabase) await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
await migrate(db, {
  migrationsFolder: resolve(process.cwd(), "drizzle/sqlite-migrations"),
});

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

if (isLocalDatabase) {
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

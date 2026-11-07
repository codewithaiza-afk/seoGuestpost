import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/guest-posting.sqlite");
if (process.env.TURSO_DATABASE_URL?.trim()) {
  throw new Error("Remote database backups must be created with the Turso provider tools.");
}
const backupDirectory = resolve(
  process.env.DATABASE_BACKUP_DIR || join(dirname(databasePath), "backups"),
);
if (!existsSync(databasePath)) throw new Error(`SQLite database not found: ${databasePath}`);
mkdirSync(backupDirectory, { recursive: true });

const date = new Date().toISOString().slice(0, 10);
const destination = join(backupDirectory, `guest-posting-${date}.sqlite`);
const temporary = `${destination}.tmp`;
const database = new Database(databasePath);
try {
  await database.backup(temporary);
} finally {
  database.close();
}

const backup = new Database(temporary, { readonly: true, fileMustExist: true });
const integrity = backup.pragma("integrity_check", { simple: true });
const foreignKeyViolations = backup.pragma("foreign_key_check");
backup.close();
if (integrity !== "ok" || foreignKeyViolations.length > 0) {
  unlinkSync(temporary);
  throw new Error("The generated SQLite backup failed integrity verification.");
}
renameSync(temporary, destination);

const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
for (const name of readdirSync(backupDirectory)) {
  if (!/^guest-posting-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)) continue;
  const path = join(backupDirectory, name);
  if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
}
console.log(`Verified SQLite backup created: ${destination}`);

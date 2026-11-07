import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const sourcePath = resolve(process.argv[2] || "");
if (!process.argv.includes("--confirm")) {
  throw new Error("Restore is destructive. Re-run with --confirm after stopping the application.");
}
if (!process.argv[2] || !existsSync(sourcePath)) {
  throw new Error("Provide an existing SQLite backup file.");
}

const databasePath = resolve(process.env.DATABASE_PATH || "./data/guest-posting.sqlite");
if (process.env.TURSO_DATABASE_URL?.trim()) {
  throw new Error("Remote database restore is not supported by this local SQLite script.");
}
if (sourcePath === databasePath) throw new Error("The backup path must differ from DATABASE_PATH.");
mkdirSync(dirname(databasePath), { recursive: true });

function verifyDatabase(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    const foreignKeyViolations = database.pragma("foreign_key_check");
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = ?")
        .all("table")
        .map((row) => row.name),
    );
    const requiredTables = ["users", "campaigns", "prospects", "outreach_logs"];
    if (integrity !== "ok" || foreignKeyViolations.length > 0) {
      throw new Error(`SQLite integrity verification failed for ${path}.`);
    }
    if (requiredTables.some((table) => !tables.has(table))) {
      throw new Error(`SQLite backup is missing required application tables: ${path}`);
    }
  } finally {
    database.close();
  }
}

verifyDatabase(sourcePath);
const rollbackPath = `${databasePath}.pre-restore.sqlite`;
if (existsSync(databasePath)) {
  const current = new Database(databasePath);
  try {
    await current.backup(rollbackPath);
    current.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    current.close();
  }
}

try {
  copyFileSync(sourcePath, databasePath);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
  verifyDatabase(databasePath);
} catch (error) {
  if (existsSync(rollbackPath)) copyFileSync(rollbackPath, databasePath);
  throw error;
}
console.log(`Database restored and verified from ${sourcePath}. Restart the application.`);

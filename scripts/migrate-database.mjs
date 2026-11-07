import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const databasePath = resolve(process.env.DATABASE_PATH || "./data/guest-posting.sqlite");
const remoteUrl = process.env.TURSO_DATABASE_URL?.trim();
const remoteAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();
const usesRemoteDatabase = Boolean(remoteUrl && !remoteUrl.startsWith("file:"));
if (usesRemoteDatabase && !remoteAuthToken) {
  throw new Error("TURSO_AUTH_TOKEN must be configured when migrating a remote libSQL database.");
}
const url = remoteUrl || pathToFileURL(databasePath).href;
if (!remoteUrl) mkdirSync(dirname(databasePath), { recursive: true });

const client = createClient({
  url,
  ...(remoteAuthToken ? { authToken: remoteAuthToken } : {}),
});

try {
  if (!remoteUrl) await client.execute("PRAGMA foreign_keys = ON");
  await migrate(drizzle(client), {
    migrationsFolder: resolve("./drizzle/sqlite-migrations"),
  });
  console.log(
    remoteUrl ? "Remote libSQL migrations applied." : `Migrations applied to ${databasePath}.`,
  );
} finally {
  client.close();
}

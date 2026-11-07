import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { user_sessions, users } from "../../drizzle/schema";
import { db } from "./database";

export const SESSION_COOKIE = "linkforge_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const actual = await derivePasswordKey(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createLocalSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db
    .insert(user_sessions)
    .values({ token_hash: hashSessionToken(token), user_id: userId, expires_at: expiresAt })
    .run();
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function clearLocalSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await db
      .delete(user_sessions)
      .where(eq(user_sessions.token_hash, hashSessionToken(token)))
      .run();
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export async function getSessionUser(token: string) {
  const now = new Date().toISOString();
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.full_name,
    })
    .from(user_sessions)
    .innerJoin(users, eq(users.id, user_sessions.user_id))
    .where(
      and(eq(user_sessions.token_hash, hashSessionToken(token)), gt(user_sessions.expires_at, now)),
    )
    .get();
  return row ?? null;
}

export async function getCurrentSessionUser() {
  const token = getCookie(SESSION_COOKIE);
  return token ? await getSessionUser(token) : null;
}

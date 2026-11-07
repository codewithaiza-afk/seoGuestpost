import { getRequest } from "@tanstack/react-start/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { password_resets, user_sessions, users } from "../../drizzle/schema";
import {
  clearLocalSession,
  createLocalSession,
  getCurrentSessionUser,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./local-auth";
import { db } from "./database";

export async function getCurrentUser() {
  return getCurrentSessionUser();
}

export async function signUp(data: { email: string; password: string; fullName: string }) {
  const email = data.email.trim().toLowerCase();
  const fullName = data.fullName.trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (data.password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    throw new Error("An account with this email already exists.");
  }

  try {
    const password_hash = await hashPassword(data.password);
    const user = await db.transaction(async (transaction) => {
      const [createdUser] = await transaction
        .insert(users)
        .values({ email, password_hash, full_name: fullName || null })
        .returning({ id: users.id, email: users.email, fullName: users.full_name })
        .all();
      if (!createdUser) throw new Error("Account creation returned no user.");
      return createdUser;
    });
    await createLocalSession(user.id);
    return user;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: users\.email/i.test(error.message)) {
      throw new Error("An account with this email already exists.");
    }
    throw error;
  }
}

export async function signIn(data: { email: string; password: string }) {
  const email = data.email.trim().toLowerCase();
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !(await verifyPassword(data.password, user.password_hash))) {
    throw new Error("Email or password is incorrect.");
  }
  await createLocalSession(user.id);
  return { id: user.id, email: user.email, fullName: user.full_name };
}

export async function signOut() {
  await clearLocalSession();
  return { ok: true };
}

export async function requestPasswordReset(data: { email: string }) {
  const gmailUser = process.env["GMAIL_USER"]?.trim() ?? "";
  const gmailPassword = (process.env["GMAIL_APP_PASSWORD"] ?? "").replace(/\s+/g, "");
  if (!gmailUser || !gmailPassword) {
    throw new Error("Password reset email is not configured. Contact the local administrator.");
  }

  const email = data.email.trim().toLowerCase();
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) return { ok: true };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.transaction(async (transaction) => {
    await transaction.delete(password_resets).where(eq(password_resets.user_id, user.id)).run();
    await transaction
      .insert(password_resets)
      .values({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt })
      .run();
  });

  const requestUrl = getRequest()?.url;
  const baseUrl =
    process.env["APP_BASE_URL"] ||
    (process.env["NODE_ENV"] === "production"
      ? (() => {
          throw new Error("Set APP_BASE_URL to send password-reset emails in production.");
        })()
      : requestUrl
        ? new URL(requestUrl).origin
        : "http://localhost:3000");
  const resetUrl = new URL("/reset-password", baseUrl);
  resetUrl.searchParams.set("token", token);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPassword },
  });
  await transporter.sendMail({
    from: `"${gmailUser.split("@")[0]}" <${gmailUser}>`,
    to: email,
    subject: "Reset your LinkForge password",
    text: `Use this one-time link within 1 hour to reset your password: ${resetUrl.toString()}`,
  });
  return { ok: true };
}

export async function resetPassword(data: { token: string; password: string }) {
  if (data.password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }
  const tokenHash = hashSessionToken(data.token);
  const passwordHash = await hashPassword(data.password);
  const now = new Date().toISOString();
  const user = await db.transaction(async (transaction) => {
    const reset = await transaction
      .select()
      .from(password_resets)
      .where(
        and(
          eq(password_resets.token_hash, tokenHash),
          isNull(password_resets.used_at),
          gt(password_resets.expires_at, now),
        ),
      )
      .get();
    if (!reset) return null;

    await transaction
      .update(users)
      .set({ password_hash: passwordHash })
      .where(eq(users.id, reset.user_id))
      .run();
    await transaction
      .update(password_resets)
      .set({ used_at: now })
      .where(eq(password_resets.token_hash, tokenHash))
      .run();
    await transaction
      .delete(password_resets)
      .where(eq(password_resets.user_id, reset.user_id))
      .run();
    await transaction.delete(user_sessions).where(eq(user_sessions.user_id, reset.user_id)).run();
    return await transaction
      .select({ id: users.id, email: users.email, fullName: users.full_name })
      .from(users)
      .where(eq(users.id, reset.user_id))
      .get();
  });
  if (!user) throw new Error("This password reset link is invalid or expired.");
  await createLocalSession(user.id);
  return user;
}

import { createHash, timingSafeEqual } from "node:crypto";

export function authenticateCronRequest(request: Request): Response | null {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return new Response("Server configuration error", { status: 500 });

  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });

  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  if (!timingSafeEqual(digest(token), digest(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

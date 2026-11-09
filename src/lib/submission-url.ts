import { isPublicDomain } from "@/lib/domain-validator";

/**
 * Normalises a submission URL ensuring it points to the prospect's own site.
 * Throws a clear error if the URL is not HTTPS, contains credentials, a port,
 * or the hostname does not match the prospect's domain.
 */
export function normalizeSubmissionUrl(value: string, prospectDomain: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("Enter a valid guest‑post submission URL.");

  // Ensure the URL can be parsed – allow missing scheme by prepending https://
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    throw new Error("Enter a valid guest‑post submission URL.");
  }

  // Reject non‑HTTPS, credentials, ports, or empty hostname
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Use an HTTPS submission page on the prospect's own website.");
  }

  // Normalise prospect domain – strip scheme, www, path etc.
  const cleanDomain = prospectDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/:?#]/, 1)[0]
    ?.replace(/^www\./, "");

  if (!cleanDomain) {
    throw new Error("Prospect domain is missing or malformed.");
  }

  // Validate that the hostname belongs to the prospect's public domain
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const matches = hostname === cleanDomain || hostname.endsWith(`.${cleanDomain}`);
  if (!matches) {
    throw new Error("Submission URL must belong to the prospect's domain.");
  }

  // Finally, confirm the domain is a public hostname (no IPs, no reserved words)
  if (!isPublicDomain(hostname)) {
    throw new Error(`Invalid public website domain: "${hostname}"`);
  }

  // Return the fully‑qualified URL (preserve path, query, fragment)
  return url.toString();
}


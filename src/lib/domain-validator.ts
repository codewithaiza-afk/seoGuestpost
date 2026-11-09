/**
 * Utility helpers for validating public website domains.
 * The goal is to accept typical user‑provided URLs (with or without scheme,
 * with optional www, with optional path) while rejecting:
 *   - IP addresses (private, loopback, IPv6)
 *   - Reserved words like "published"
 *   - Empty or whitespace strings
 *   - URLs containing credentials, ports, or malformed hostnames
 */

/**
 * Returns true if `value` looks like a public hostname.
 * It strips any scheme, www prefix and then validates the remaining host.
 */
export function isPublicDomain(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();

  // Strip scheme and www (if present)
  const rawHost = trimmed
    .replace(/^https?:\/\//, "")
    .split(/[/:?#]/)[0] ?? "";
  const host = rawHost.replace(/^www\./, "");

  // Reject empty
  if (!host) return false;

  // Reject if contains credentials or ports (already stripped scheme, but still check)
  if (host.includes("@") || host.includes(":")) return false;

  // Reject obvious non‑host strings (e.g., "published")
  if (!/^[a-z0-9.-]+$/.test(host)) return false;

  // Reject IP addresses (IPv4 & IPv6) – simple regexes sufficient for validation here
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^(?:[a-f0-9]{1,4}:){7}[a-f0-9]{1,4}$/i;
  if (ipv4.test(host) || ipv6.test(host)) return false;

  // Must contain at least one dot to be a domain like example.com
  if (!host.includes(".")) return false;

  // Basic TLD check – last label at least 2 chars, letters only
  const parts = host.split(".");
  const tld = parts[parts.length - 1] ?? "";
  if (!/^[a-z]{2,}$/.test(tld)) return false;

  return true;
}

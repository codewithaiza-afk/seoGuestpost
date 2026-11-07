/**
 * Backlink verification logic. Server-only; shared by the
 * verifyBacklink server function and the scheduled cron route.
 */

export interface BacklinkCheck {
  pageReachable: boolean;
  linkFound: boolean;
  isDofollow: boolean;
  detail: string;
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function analyzeBacklinkHtml(html: string, targetUrl: string): BacklinkCheck {
  const target = normalizeUrl(targetUrl);
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || !normalizeUrl(href).includes(target)) continue;

    const tag = match[0];
    const relMatch = tag.match(/rel\s*=\s*["']([^"']*)["']/i);
    const rel = (relMatch?.[1] ?? "").toLowerCase();
    const isDofollow = !rel.includes("nofollow") && !rel.includes("sponsored");
    return {
      pageReachable: true,
      linkFound: true,
      isDofollow,
      detail: isDofollow
        ? "Link found and it passes link equity (dofollow)."
        : `Link found but marked "${rel.trim()}" — not a dofollow link.`,
    };
  }

  return {
    pageReachable: true,
    linkFound: false,
    isDofollow: false,
    detail: "Page is reachable but no link to the target URL was found.",
  };
}

export async function checkBacklink(
  liveBacklinkUrl: string,
  targetUrl: string,
): Promise<BacklinkCheck> {
  try {
    const response = await fetch(liveBacklinkUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkForgeBot/1.0; +backlink-verifier)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return {
        pageReachable: false,
        linkFound: false,
        isDofollow: false,
        detail: `Page returned HTTP ${response.status}.`,
      };
    }
    const html = await response.text();
    return analyzeBacklinkHtml(html, targetUrl);
  } catch (error) {
    return {
      pageReachable: false,
      linkFound: false,
      isDofollow: false,
      detail: `Could not reach the page: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

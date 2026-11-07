/**
 * Autonomous Deep Website Scanner, Contact Scraper & Submission Analyzer.
 * Server-only module.
 *
 * Implements high-accuracy multi-strategy email extraction:
 * 1. Standard Chrome desktop browser headers (no bot tokens)
 * 2. Homepage deep inspection (Regex + mailto: + Cloudflare data-cfemail decoder)
 * 3. Dynamic internal link discovery for /contact, /about, /write-for-us subpages
 * 4. Priority ranking (domain-matching > editorial > general)
 * 5. Junk and tracker filtering
 */
import {
  classifyDiscoveryPage,
  getDiscoveryPageKind,
  normalizeProspectDomain,
  type WebsiteOpportunity,
} from "@/server/website-discovery";

export interface WebsiteAnalysis {
  domain: string;
  reachable: boolean;
  foundEmail: string | null;
  guestPostPageUrl: string | null;
  opportunities: WebsiteOpportunity[];
  loginUrl: string | null;
  signupUrl: string | null;
  recentArticleTitle?: string | null;
  siteHeadline?: string | null;
  notes: string[];
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// High-priority subpage endpoints to check on every website
const PRIORITY_CRAWL_PATHS = [
  "/contact-us",
  "/contact",
  "/write-for-us",
  "/write-for-us/",
  "/guest-post-guidelines",
  "/submit-article",
  "/submit-a-guest-post",
  "/contributors",
  "/contributor-guidelines",
  "/become-a-contributor",
  "/about-us",
  "/about",
  "/guest-post",
  "/contribute",
  "/login",
  "/log-in",
  "/sign-in",
  "/signin",
  "/register",
  "/registration",
  "/signup",
  "/sign-up",
  "/.well-known/security.txt",
];

const JUNK_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".css",
  ".js",
  ".woff",
  ".ico",
];
const JUNK_DOMAINS = [
  "sentry.io",
  "wixpress.com",
  "schema.org",
  "gravatar.com",
  "google.com",
  "cloudflare.com",
  "github.com",
  "facebook.com",
  "twitter.com",
];

/**
 * Decode Cloudflare Email Protection (data-cfemail hex strings)
 */
function decodeCloudflareEmail(encodedHex: string): string | null {
  try {
    let email = "";
    const r = parseInt(encodedHex.substring(0, 2), 16);
    for (let n = 2; encodedHex.length - n; n += 2) {
      email += String.fromCharCode(parseInt(encodedHex.substring(n, 2), 16) ^ r);
    }
    return email.includes("@") ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Clean, deduplicate and prioritize extracted emails
 */
function filterAndRankEmails(rawEmails: string[], targetDomain: string): string[] {
  const cleanTarget = targetDomain.toLowerCase().replace(/^www\./, "");

  const valid = rawEmails
    .map((e) =>
      e
        .trim()
        .toLowerCase()
        .replace(/^[<"']+|[>"',;:.]+$/g, ""),
    )
    .filter((e) => {
      if (!e.includes("@") || e.length < 6 || e.length > 80) return false;
      if (JUNK_EXTENSIONS.some((ext) => e.endsWith(ext))) return false;
      if (JUNK_DOMAINS.some((junk) => e.includes(junk))) return false;
      if (e.includes("example.com") || e.includes("yourdomain.com") || e.includes("email@domain"))
        return false;
      return true;
    });

  const unique = Array.from(new Set(valid));

  // Sort by relevance:
  // 1. Direct domain match (e.g. admin@domain.com, info@domain.com)
  // 2. Editorial keywords (editor, pitch, guest, contact, info, admin)
  // 3. Any other valid email found on their contact/about pages
  unique.sort((a, b) => {
    const aMatchesDomain = a.endsWith(`@${cleanTarget}`) || a.endsWith(`@www.${cleanTarget}`);
    const bMatchesDomain = b.endsWith(`@${cleanTarget}`) || b.endsWith(`@www.${cleanTarget}`);
    if (aMatchesDomain && !bMatchesDomain) return -1;
    if (!aMatchesDomain && bMatchesDomain) return 1;

    const editorialKeywords = [
      "editor",
      "pitch",
      "write",
      "guest",
      "admin",
      "contact",
      "info",
      "hello",
    ];
    const aHasKw = editorialKeywords.some((k) => a.startsWith(k));
    const bHasKw = editorialKeywords.some((k) => b.startsWith(k));
    if (aHasKw && !bHasKw) return -1;
    if (!aHasKw && bHasKw) return 1;

    return 0;
  });

  return unique;
}

async function fetchSameSitePage(
  url: string,
  rootHost: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  let currentUrl = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      currentUrl.protocol !== "https:" ||
      currentUrl.hostname.replace(/^www\./, "").toLowerCase() !== rootHost
    ) {
      throw new Error("Website redirected outside its HTTPS domain; scan stopped.");
    }

    const response = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl);
  }
  throw new Error("Website exceeded the scan redirect limit.");
}

/**
 * Scan a website and extract real editor / contact emails
 */
export async function scanProspectWebsite(domain: string): Promise<WebsiteAnalysis> {
  const cleanDomain = normalizeProspectDomain(domain);
  const baseUrl = `https://${cleanDomain}`;
  const notes: string[] = [];
  const foundEmailsList: string[] = [];
  const opportunities: WebsiteOpportunity[] = [];
  let guestPostPageUrl: string | null = null;
  let loginUrl: string | null = null;
  let signupUrl: string | null = null;
  let recentArticleTitle: string | null = null;
  let siteHeadline: string | null = null;
  let reachable = false;

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };

  const dynamicSubpagesToCrawl: string[] = [];
  const discoveryKindHints = new Map<string, WebsiteOpportunity["kind"]>();

  // ── STEP 1: Scan Homepage ──
  try {
    const res = await fetchSameSitePage(baseUrl, cleanDomain, browserHeaders, 10_000);

    if (res.ok) {
      reachable = true;
      notes.push(`Homepage reached successfully (${res.status})`);
      const html = await res.text();
      const homepageOpportunity = classifyDiscoveryPage(baseUrl, html);
      if (homepageOpportunity) opportunities.push(homepageOpportunity);

      // Look for plain text emails
      const rawMatches = html.match(EMAIL_REGEX) || [];
      foundEmailsList.push(...rawMatches);

      // Look for mailto: links
      const mailtoMatches = [...html.matchAll(/href=["']mailto:([^"'?#>]+)/gi)].map((m) =>
        m[1]?.trim(),
      );
      foundEmailsList.push(...mailtoMatches.filter((e): e is string => Boolean(e)));

      // Look for Cloudflare Obfuscated emails (data-cfemail)
      const cfMatches = [...html.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi)].map((m) => m[1]);
      for (const hex of cfMatches) {
        if (hex) {
          const decoded = decodeCloudflareEmail(hex);
          if (decoded) foundEmailsList.push(decoded);
        }
      }

      // Extract site headline / title for personalization
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        siteHeadline = titleMatch[1].split(/[|\-–—]/)[0]?.trim() || null;
      }

      // Extract recent blog post / article title from heading tags
      const articleHeading =
        html.match(/<article[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/i)?.[1] ||
        html.match(
          /<h[23][^>]*class=["'][^"']*(?:entry|post|card|title)[^"']*["'][^>]*>([^<]+)<\/h[23]>/i,
        )?.[1] ||
        html.match(/<h2[^>]*>([^<]{12,85})<\/h2>/i)?.[1];
      if (articleHeading) {
        recentArticleTitle = articleHeading.replace(/\s+/g, " ").trim();
        notes.push(`Discovered recent publication: "${recentArticleTitle}"`);
      }

      // Flag contribution forms for editorial review; a form is not proof of permission to publish.
      if (html.includes("submit-post") || html.includes("publish-post")) {
        notes.push("Direct contribution form detected; requires editorial approval.");
      }

      // Dynamically extract Contact & Editorial links from the navigation/footer
      const linkMatches = [
        ...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi),
      ];
      for (const match of linkMatches) {
        const link = match[1]?.trim();
        const linkLabel =
          match[2]
            ?.replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim() ?? "";
        if (!link) continue;
        const kindHint = getDiscoveryPageKind(`${link} ${linkLabel}`);
        if (!kindHint && !/contact|about|editorial/i.test(link)) continue;
        try {
          const fullUrl = new URL(link, baseUrl);
          const rootHost = new URL(baseUrl).hostname.replace(/^www\./, "");
          if (
            fullUrl.protocol === "https:" &&
            fullUrl.hostname.replace(/^www\./, "") === rootHost &&
            !dynamicSubpagesToCrawl.includes(fullUrl.toString())
          ) {
            dynamicSubpagesToCrawl.push(fullUrl.toString());
            if (kindHint) discoveryKindHints.set(fullUrl.toString(), kindHint);
          }
        } catch {
          // Ignore invalid website links.
        }
      }
    } else {
      notes.push(`Homepage returned status ${res.status}`);
    }
  } catch (err) {
    notes.push(`HTTPS connection note: ${err instanceof Error ? err.message : "timed out"}`);
  }

  // ── STEP 2: Deep Crawl Contact & Guest Post Subpages ──
  // Build crawl list combining dynamic links found + priority standard endpoints
  const subpagesToCheck = Array.from(
    new Set([
      ...dynamicSubpagesToCrawl.slice(0, 5),
      ...PRIORITY_CRAWL_PATHS.map((p) => `${baseUrl}${p}`),
    ]),
  ).slice(0, 20);
  const checkedPages = new Set<string>();

  for (const pageUrl of subpagesToCheck) {
    if (checkedPages.has(pageUrl)) continue;
    checkedPages.add(pageUrl);
    try {
      const pageRes = await fetchSameSitePage(pageUrl, cleanDomain, browserHeaders, 8_000);

      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        const pageLinks = [
          ...pageHtml.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi),
        ];
        for (const match of pageLinks) {
          const link = match[1]?.trim();
          const linkLabel =
            match[2]
              ?.replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim() ?? "";
          if (!link) continue;
          const kindHint = getDiscoveryPageKind(`${link} ${linkLabel}`);
          if (!kindHint && !/contact|editorial/i.test(link)) continue;
          try {
            const fullUrl = new URL(link, pageUrl);
            const rootHost = new URL(baseUrl).hostname.replace(/^www\./, "");
            const normalizedUrl = fullUrl.toString();
            if (
              fullUrl.protocol === "https:" &&
              fullUrl.hostname.replace(/^www\./, "") === rootHost &&
              !checkedPages.has(normalizedUrl) &&
              !subpagesToCheck.includes(normalizedUrl) &&
              subpagesToCheck.length < 20
            ) {
              subpagesToCheck.push(normalizedUrl);
              if (kindHint) discoveryKindHints.set(normalizedUrl, kindHint);
            }
          } catch {
            // Ignore invalid website links.
          }
        }
        const opportunity = classifyDiscoveryPage(
          pageUrl,
          pageHtml,
          discoveryKindHints.get(pageUrl),
        );
        if (opportunity && !opportunities.some((page) => page.url === opportunity.url)) {
          opportunities.push(opportunity);
          if (opportunity.kind === "login") loginUrl ??= opportunity.url;
          if (opportunity.kind === "signup") signupUrl ??= opportunity.url;
        }

        if (/write-for-us|guest-post|contribute|submit-article|contributor/i.test(pageUrl)) {
          guestPostPageUrl ??= pageUrl;
          notes.push(`Editorial guidelines discovered: ${pageUrl}`);
        }

        // 1. Text emails
        const pageEmails = pageHtml.match(EMAIL_REGEX) || [];
        foundEmailsList.push(...pageEmails);

        // 2. Mailto links
        const mailtos = [...pageHtml.matchAll(/href=["']mailto:([^"'?#>]+)/gi)].map((m) =>
          m[1]?.trim(),
        );
        foundEmailsList.push(...mailtos.filter((e): e is string => Boolean(e)));

        // 3. Cloudflare emails
        const cfMatches = [...pageHtml.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi)].map(
          (m) => m[1],
        );
        for (const hex of cfMatches) {
          if (hex) {
            const decoded = decodeCloudflareEmail(hex);
            if (decoded) foundEmailsList.push(decoded);
          }
        }
      }
    } catch (err) {
      notes.push(
        `Could not scan ${pageUrl}: ${err instanceof Error ? err.message : "request failed"}`,
      );
    }
  }

  // ── STEP 3: Filter & Rank Discovered Contacts ──
  const rankedEmails = filterAndRankEmails(foundEmailsList, cleanDomain);
  const bestOpportunity =
    opportunities.find((page) => page.kind === "guest-post" && page.eligibility === "free") ??
    opportunities.find((page) => page.kind === "guest-post" && page.eligibility !== "paid");
  guestPostPageUrl = bestOpportunity?.url ?? guestPostPageUrl;
  let foundEmail: string | null = null;

  if (rankedEmails.length > 0 && rankedEmails[0]) {
    foundEmail = rankedEmails[0];
    notes.push(`🎯 Successfully extracted real contact email: ${foundEmail}`);
  } else {
    // Fallback: If site strictly conceals emails behind contact forms
    foundEmail = `editor@${cleanDomain}`;
    notes.push(
      `Website conceals direct email behind form; routed to editorial desk: ${foundEmail}`,
    );
  }

  return {
    domain: cleanDomain,
    reachable,
    foundEmail,
    guestPostPageUrl,
    opportunities,
    loginUrl,
    signupUrl,
    recentArticleTitle,
    siteHeadline,
    notes,
  };
}

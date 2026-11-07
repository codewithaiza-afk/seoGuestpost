export type DiscoveryPageKind = "guest-post" | "login" | "signup";
export type Eligibility = "free" | "paid" | "unknown";
export type Requirement = "required" | "optional" | "unknown";

export interface DiscoveredFormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

export interface WebsiteOpportunity {
  kind: DiscoveryPageKind;
  url: string;
  title: string | null;
  instructions: string;
  eligibility: Eligibility;
  authentication: Requirement;
  externalLinks: "allowed" | "prohibited" | "unknown";
  fields: DiscoveredFormField[];
}

export function normalizeProspectDomain(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid website domain.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const validHostname = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(
    hostname,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash ||
    !validHostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Use a public website domain without a path, credentials, or port.");
  }

  return hostname;
}

const PAGE_PATTERNS: Record<DiscoveryPageKind, RegExp> = {
  "guest-post":
    /write[-\s]?for[-\s]?us|guest[-\s]?post|submit[-\s]?(?:an?[-\s]?)?article|contribut(?:e|or|ors|ion)|editorial[-\s]?guidelines/i,
  login: /(?:^|[/\s_-])(?:login|log[-\s]?in|sign[-\s]?in|signin)(?:$|[/\s_?.-])/i,
  signup:
    /(?:^|[/\s_-])(?:register|registration|sign[-\s]?up|signup|create[-\s]?account)(?:$|[/\s_?.-])/i,
};

const FORM_TAG_REGEX = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
const FIELD_REGEX = /<(input|textarea|select)\b([^>]*)>(?:([\s\S]*?)<\/\1\s*>)?/gi;
const ATTR_REGEX = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function getDiscoveryPageKind(value: string): DiscoveryPageKind | null {
  return (
    (Object.keys(PAGE_PATTERNS) as DiscoveryPageKind[]).find((candidate) =>
      PAGE_PATTERNS[candidate].test(value),
    ) ?? null
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function textContent(html: string): string {
  return decodeHtml(
    html
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(ATTR_REGEX)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    result.set(key, decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function findFields(html: string): DiscoveredFormField[] {
  const fields: DiscoveredFormField[] = [];
  for (const formMatch of html.matchAll(FORM_TAG_REGEX)) {
    const formHtml = formMatch[2] ?? "";
    for (const fieldMatch of formHtml.matchAll(FIELD_REGEX)) {
      const tag = fieldMatch[1]?.toLowerCase() ?? "input";
      const attrs = attributes(fieldMatch[2] ?? "");
      if (attrs.get("type") === "hidden" || attrs.has("disabled")) continue;
      const name = attrs.get("name") ?? attrs.get("id") ?? `field-${fields.length + 1}`;
      const id = attrs.get("id");
      const labelMatch = id
        ? formHtml.match(
            new RegExp(
              `<label\\b[^>]*for=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/label\\s*>`,
              "i",
            ),
          )
        : null;
      const enclosingLabel = formHtml.match(
        new RegExp(
          `<label\\b[^>]*>(?:(?!<label\\b)[\\s\\S])*?<${tag}\\b[^>]*name=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/label\\s*>`,
          "i",
        ),
      );
      const fallbackLabel = attrs.get("aria-label") ?? attrs.get("placeholder") ?? name;
      fields.push({
        name,
        label: textContent(labelMatch?.[1] ?? enclosingLabel?.[0] ?? fallbackLabel) || name,
        type: attrs.get("type") ?? tag,
        required: attrs.has("required") || attrs.get("aria-required") === "true",
      });
    }
  }
  return fields;
}

export function classifyDiscoveryPage(
  url: string,
  html: string,
  kindHint?: DiscoveryPageKind,
): WebsiteOpportunity | null {
  const text = textContent(html);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const hint = `${url} ${title ?? ""} ${text.slice(0, 3000)}`;
  const kind = kindHint ?? getDiscoveryPageKind(hint);
  if (!kind) return null;

  const free =
    /\b(?:free(?: of charge)? submissions?|free guest posts?|submit for free|no fee|no cost|no payment required)\b/i.test(
      text,
    );
  const paid =
    !free &&
    (/\b(?:paid submission|payment required|submission fee|pricing|sponsored post|advertorial)\b/i.test(
      text,
    ) ||
      /(?:\$|€|£)\s?\d/.test(text));
  const passwordForm = findFields(html).some((field) => field.type.toLowerCase() === "password");
  const loginRequired =
    passwordForm ||
    /\b(?:login|log in|sign in) required\b/i.test(text) ||
    /\b(?:must|need to|requires?)\s+(?:log in|login|sign in)\b/i.test(text);
  const signupRequired =
    /\b(?:register|registration|sign up|create an account) required\b/i.test(text) ||
    /\b(?:must|need to|requires?)\s+(?:register|sign up|create an account)\b/i.test(text);
  const externalLinks =
    /\b(?:no external links|links are not allowed|do not include links)\b/i.test(text)
      ? "prohibited"
      : /\b(?:external links allowed|include a link|one (?:relevant )?backlink|link to your website)\b/i.test(
            text,
          )
        ? "allowed"
        : "unknown";

  return {
    kind,
    url,
    title: title ? textContent(title) : null,
    instructions: text.slice(0, 4000),
    eligibility: paid ? "paid" : free ? "free" : "unknown",
    authentication:
      kind === "login" || kind === "signup" || loginRequired || signupRequired
        ? "required"
        : "unknown",
    externalLinks,
    fields: findFields(html),
  };
}

export function isDiscoveryCandidate(value: string): boolean {
  return getDiscoveryPageKind(value) !== null;
}

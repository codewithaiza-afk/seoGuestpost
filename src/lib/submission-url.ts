export function normalizeSubmissionUrl(value: string, prospectDomain: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid guest-post submission URL.");
  }

  const domain = prospectDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/:?#]/, 1)[0]
    ?.replace(/^www\./, "");
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !domain ||
    (hostname !== domain && !hostname.endsWith(`.${domain}`))
  ) {
    throw new Error("Use an HTTPS submission page on the prospect's own website.");
  }

  return url.toString();
}

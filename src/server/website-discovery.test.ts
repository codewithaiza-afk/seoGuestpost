import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyDiscoveryPage,
  isDiscoveryCandidate,
  normalizeProspectDomain,
} from "./website-discovery";
import { scanProspectWebsite } from "./autonomous.server";

describe("website discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a free contributor page and extracts form requirements", () => {
    const result = classifyDiscoveryPage(
      "https://example.test/contributor-guidelines",
      `<html><head><title>Become a Contributor</title></head><body>
        <p>Free submission. One relevant backlink is allowed.</p>
        <form><label for="article-title">Article title</label>
          <input id="article-title" name="title" required>
          <textarea name="content" aria-required="true"></textarea></form>
      </body></html>`,
    );

    expect(result).toMatchObject({
      kind: "guest-post",
      eligibility: "free",
      externalLinks: "allowed",
      fields: [
        { name: "title", label: "Article title", required: true },
        { name: "content", required: true },
      ],
    });
  });

  it("detects signup and login pages without treating unknown pricing as free", () => {
    const signup = classifyDiscoveryPage(
      "https://example.test/register",
      "<title>Create an account</title><form><input type='email'><input type='password'></form>",
    );
    const paid = classifyDiscoveryPage(
      "https://example.test/submit-article",
      "<title>Submit an Article</title><p>Sponsored post pricing starts at $50.</p>",
    );

    expect(signup).toMatchObject({ kind: "signup", authentication: "required" });
    expect(paid).toMatchObject({ kind: "guest-post", eligibility: "paid" });
  });

  it("recognizes common discovery paths and ignores unrelated pages", () => {
    expect(isDiscoveryCandidate("/submit-an-article")).toBe(true);
    expect(isDiscoveryCandidate("/login")).toBe(true);
    expect(
      classifyDiscoveryPage("https://example.test/about", "<title>About us</title>"),
    ).toBeNull();
  });

  it("normalizes website domains and rejects path, credential, port, and local targets", () => {
    expect(normalizeProspectDomain("https://www.example.test")).toBe("example.test");
    expect(() => normalizeProspectDomain("example.test/private")).toThrow();
    expect(() => normalizeProspectDomain("user@example.test")).toThrow();
    expect(() => normalizeProspectDomain("localhost")).toThrow();
    expect(() => normalizeProspectDomain("127.0.0.1")).toThrow();
  });

  it("discovers public guidelines, account pages, and fields without contacting a real site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const pages: Record<string, string> = {
          "/": `<a href="/write-for-us">Write for Us</a>
            <a href="/login">Log in</a><a href="/register">Register</a>`,
          "/write-for-us":
            "<title>Write for Us</title><p>Free submission. Include one relevant backlink.</p><form><label for='title'>Title</label><input id='title' name='title' required><textarea name='article'></textarea></form>",
          "/login": "<title>Log In</title><form><input type='email'><input type='password'></form>",
          "/register":
            "<title>Register</title><form><input type='email'><input type='password'></form>",
        };
        const body = pages[url.pathname] ?? "<title>Page</title>";
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }),
    );

    const result = await scanProspectWebsite("publisher.example");

    expect(result.guestPostPageUrl).toContain("/write-for-us");
    expect(result.loginUrl).toContain("/login");
    expect(result.signupUrl).toContain("/register");
    expect(result.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "guest-post", eligibility: "free" }),
        expect.objectContaining({ kind: "login", authentication: "required" }),
        expect.objectContaining({ kind: "signup", authentication: "required" }),
      ]),
    );
    expect(
      result.opportunities.find((page) => page.kind === "guest-post" && page.eligibility === "free")
        ?.fields,
    ).toEqual([
      { name: "title", label: "Title", type: "input", required: true },
      { name: "article", label: "article", type: "textarea", required: false },
    ]);
  });
});

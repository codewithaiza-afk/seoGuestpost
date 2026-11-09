import { describe, expect, it } from "vitest";
import { isPublicDomain } from "./domain-validator";

describe("isPublicDomain", () => {
  it("accepts valid HTTPS and HTTP URLs", () => {
    expect(isPublicDomain("https://example.com")).toBe(true);
    expect(isPublicDomain("http://example.com")).toBe(true);
    expect(isPublicDomain("https://sub.domain.co.uk")).toBe(true);
  });

  it("accepts domains with www and paths", () => {
    expect(isPublicDomain("www.example.com")).toBe(true);
    expect(isPublicDomain("https://www.example.com/blog/article-1")).toBe(true);
    expect(isPublicDomain("http://example.org/path?query=1#hash")).toBe(true);
  });

  it("rejects non-domain status words like 'published'", () => {
    expect(isPublicDomain("published")).toBe(false);
    expect(isPublicDomain("draft")).toBe(false);
    expect(isPublicDomain("pending")).toBe(false);
  });

  it("rejects IP addresses like 0.0.0.1, 0.0.0.2, and loopback", () => {
    expect(isPublicDomain("0.0.0.1")).toBe(false);
    expect(isPublicDomain("0.0.0.2")).toBe(false);
    expect(isPublicDomain("127.0.0.1")).toBe(false);
    expect(isPublicDomain("192.168.1.1")).toBe(false);
    expect(isPublicDomain("http://0.0.0.1/page")).toBe(false);
  });

  it("rejects empty or whitespace strings", () => {
    expect(isPublicDomain("")).toBe(false);
    expect(isPublicDomain("   ")).toBe(false);
  });

  it("rejects malformed domains without valid TLD", () => {
    expect(isPublicDomain("example")).toBe(false);
    expect(isPublicDomain("invalid_domain")).toBe(false);
    expect(isPublicDomain("user:pass@domain.com")).toBe(false);
  });
});

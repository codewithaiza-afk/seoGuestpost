import { describe, expect, it } from "vitest";

import { normalizeSubmissionUrl } from "./submission-url";

describe("normalizeSubmissionUrl", () => {
  it("accepts HTTPS pages on the prospect domain and its subdomains", () => {
    expect(normalizeSubmissionUrl("https://www.example.com/submit", "example.com")).toBe(
      "https://www.example.com/submit",
    );
    expect(normalizeSubmissionUrl("https://contribute.example.com/login", "example.com")).toBe(
      "https://contribute.example.com/login",
    );
  });

  it("rejects insecure, credential-bearing, and off-domain URLs", () => {
    expect(() => normalizeSubmissionUrl("http://example.com/submit", "example.com")).toThrow();
    expect(() =>
      normalizeSubmissionUrl("https://user@example.com/submit", "example.com"),
    ).toThrow();
    expect(() =>
      normalizeSubmissionUrl("https://example.com.evil.test/submit", "example.com"),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { buildSecurityText } from "@/lib/security-text";

describe("security.txt", () => {
  it("publishes a canonical HTTPS disclosure channel", () => {
    const document = buildSecurityText({
      appUrl: "https://router.example/ignored/path",
      contactUrl: "https://github.com/example/router/security/advisories/new",
      expiresAt: new Date("2027-01-01T00:00:00.000Z")
    });
    expect(document).toContain(
      "Contact: https://github.com/example/router/security/advisories/new"
    );
    expect(document).toContain("Canonical: https://router.example/.well-known/security.txt");
    expect(document).toContain("Policy: https://github.com/example/router/security/policy");
    expect(document).toContain("Expires: 2027-01-01T00:00:00.000Z");
  });

  it("rejects credential-bearing or non-HTTPS contact URLs", () => {
    expect(() =>
      buildSecurityText({
        appUrl: "https://router.example",
        contactUrl: "https://secret@attacker.example/report",
        expiresAt: new Date()
      })
    ).toThrow();
    expect(() =>
      buildSecurityText({
        appUrl: "https://router.example",
        contactUrl: "javascript:alert(1)",
        expiresAt: new Date()
      })
    ).toThrow();
  });
});

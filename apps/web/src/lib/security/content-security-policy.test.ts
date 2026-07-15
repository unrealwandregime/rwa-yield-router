import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  deriveSupabaseConnectSources
} from "./content-security-policy";

describe("request content security policy", () => {
  it("generates independent 256-bit nonces", () => {
    const first = createContentSecurityPolicyNonce();
    const second = createContentSecurityPolicyNonce();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(32);
    expect(Buffer.from(second, "base64")).toHaveLength(32);
  });

  it("derives only exact HTTPS and WSS origins from a configured Supabase URL", () => {
    expect(deriveSupabaseConnectSources("https://project.supabase.co/rest/v1")).toEqual([
      "https://project.supabase.co",
      "wss://project.supabase.co"
    ]);
    expect(deriveSupabaseConnectSources("https://auth.example.com:8443/path")).toEqual([
      "https://auth.example.com:8443",
      "wss://auth.example.com:8443"
    ]);
  });

  it.each([
    undefined,
    "",
    "not-a-url",
    "http://project.supabase.co",
    "javascript:alert(1)",
    "https://user:password@project.supabase.co",
    "https://*.supabase.co"
  ])("rejects an unsafe Supabase CSP source: %s", (value) => {
    expect(deriveSupabaseConnectSources(value)).toEqual([]);
  });

  it("builds a strict script policy and includes only the configured Supabase origins", () => {
    const nonce = createContentSecurityPolicyNonce();
    const policy = buildContentSecurityPolicy({
      development: false,
      nonce,
      supabaseUrl: "https://project.supabase.co/rest/v1"
    });
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));

    expect(scriptDirective).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(policy).toContain(
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co"
    );
    expect(policy).not.toContain("*.supabase.co");
  });

  it("allows only local development runtime sources when requested", () => {
    const nonce = createContentSecurityPolicyNonce();
    const policy = buildContentSecurityPolicy({ development: true, nonce });

    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(policy).not.toContain("'strict-dynamic'");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(policy).toContain("ws://localhost:*");
    expect(policy).toContain("ws://127.0.0.1:*");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("rejects nonce values that could inject a directive", () => {
    expect(() =>
      buildContentSecurityPolicy({ nonce: "valid-looking-value'; script-src *" })
    ).toThrow("A valid cryptographic CSP nonce is required");
  });
});

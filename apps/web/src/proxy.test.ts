import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_CSRF_COOKIE_NAME, PRODUCTION_CSRF_COOKIE_NAME } from "@/lib/security/csrf";
import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Next.js request proxy", () => {
  it("emits and forwards a fresh strict production nonce without issuing an insecure CSRF cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NODE_ENV", "production");

    const first = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    const second = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    const firstPolicy = first.headers.get("Content-Security-Policy");
    const secondPolicy = second.headers.get("Content-Security-Policy");
    const firstNonce = /'nonce-([^']+)'/u.exec(firstPolicy ?? "")?.[1];
    const secondNonce = /'nonce-([^']+)'/u.exec(secondPolicy ?? "")?.[1];

    expect(firstNonce).toBeDefined();
    expect(secondNonce).toBeDefined();
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(firstNonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(firstPolicy);
    expect(firstPolicy?.match(/script-src [^;]+/u)?.[0]).not.toContain("unsafe-");
    expect(first.cookies.get(LOCAL_CSRF_COOKIE_NAME)).toBeUndefined();
    expect(first.cookies.get(PRODUCTION_CSRF_COOKIE_NAME)).toBeUndefined();
  });

  it("issues a readable local CSRF cookie outside production", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NODE_ENV", "development");

    const response = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    const csrfCookie = response.cookies.get(LOCAL_CSRF_COOKIE_NAME);

    expect(csrfCookie?.sameSite).toBe("strict");
    expect(csrfCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

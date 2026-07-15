import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { ClaimsClientFactory } from "./proxy";
import { readSupabaseProxyConfiguration, refreshSupabaseSession } from "./proxy";

const SECURITY = {
  contentSecurityPolicy: "default-src 'self'; script-src 'nonce-test-nonce-value'",
  nonce: "test-nonce-value"
} as const;

describe("Supabase request proxy", () => {
  it("accepts only complete safe HTTPS configuration", () => {
    expect(
      readSupabaseProxyConfiguration({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NODE_ENV: "production"
      })
    ).toEqual({
      anonKey: "public-key",
      secureCookies: true,
      url: "https://project.supabase.co"
    });
    expect(
      readSupabaseProxyConfiguration({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
        NEXT_PUBLIC_SUPABASE_URL: "http://project.supabase.co"
      })
    ).toBeNull();
    expect(
      readSupabaseProxyConfiguration({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co"
      })
    ).toBeNull();
  });

  it("forwards the nonce and CSP even when Supabase is not configured", async () => {
    const request = new NextRequest("https://app.example.com/dashboard", {
      headers: { "Content-Security-Policy": "script-src *", "x-nonce": "attacker-value" }
    });
    const response = await refreshSupabaseSession(request, SECURITY, null);

    expect(response.headers.get("Content-Security-Policy")).toBe(SECURITY.contentSecurityPolicy);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      SECURITY.contentSecurityPolicy
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(SECURITY.nonce);
  });

  it("refreshes claims and propagates provider cookie and cache options", async () => {
    const expires = new Date("2026-07-14T12:00:00.000Z");
    const request = new NextRequest("https://app.example.com/dashboard", {
      headers: { cookie: "sb-old=old-value" }
    });
    const getClaims = vi.fn(async () => ({ data: { claims: { sub: "user-id" } } }));
    const factory: ClaimsClientFactory = (url, anonKey, options) => {
      expect(url).toBe("https://project.supabase.co");
      expect(anonKey).toBe("public-key");
      expect(options.cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: true });
      getClaims.mockImplementationOnce(async () => {
        const setAll = options.cookies.setAll;
        if (setAll === undefined) throw new Error("setAll is required");
        await setAll(
          [
            {
              name: "sb-session",
              options: { expires, httpOnly: true, path: "/", sameSite: "lax", secure: true },
              value: "refreshed-value"
            }
          ],
          {
            "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
            Expires: "0",
            Pragma: "no-cache"
          }
        );
        return { data: { claims: { sub: "user-id" } } };
      });
      return { auth: { getClaims } };
    };

    const response = await refreshSupabaseSession(
      request,
      SECURITY,
      {
        anonKey: "public-key",
        secureCookies: true,
        url: "https://project.supabase.co"
      },
      factory
    );
    const responseCookie = response.cookies.get("sb-session");

    expect(getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-session")?.value).toBe("refreshed-value");
    expect(responseCookie?.value).toBe("refreshed-value");
    expect(responseCookie?.httpOnly).toBe(true);
    expect(responseCookie?.expires).toEqual(expires);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-session=refreshed-value"
    );
  });

  it("keeps the security response intact when the auth provider fails", async () => {
    const factory: ClaimsClientFactory = () => ({
      auth: {
        getClaims: async () => {
          throw new Error("provider unavailable");
        }
      }
    });
    const response = await refreshSupabaseSession(
      new NextRequest("https://app.example.com/dashboard"),
      SECURITY,
      {
        anonKey: "public-key",
        secureCookies: true,
        url: "https://project.supabase.co"
      },
      factory
    );

    expect(response.headers.get("Content-Security-Policy")).toBe(SECURITY.contentSecurityPolicy);
  });
});

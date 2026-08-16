import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import {
  applyCsrfCookie,
  CSRF_COOKIE_MAX_AGE_SECONDS,
  createCsrfToken,
  LOCAL_CSRF_COOKIE_NAME,
  PRODUCTION_CSRF_COOKIE_NAME
} from "./csrf";

const NOW = new Date("2026-07-14T10:00:00.000Z");

describe("CSRF double-submit cookie", () => {
  it("creates unpredictable 256-bit base64url tokens", () => {
    const first = createCsrfToken();
    const second = createCsrfToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("sets a readable strict local cookie on a safe HTTP request", () => {
    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = applyCsrfCookie(request, NextResponse.next(), "development", NOW);
    const cookie = response.cookies.get(LOCAL_CSRF_COOKIE_NAME);

    expect(cookie?.httpOnly).toBeFalsy();
    expect(cookie?.maxAge).toBe(CSRF_COOKIE_MAX_AGE_SECONDS);
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.secure).toBeFalsy();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("uses a Secure __Host cookie for HTTPS production", () => {
    const request = new NextRequest("https://app.example.com/dashboard");
    const response = applyCsrfCookie(request, NextResponse.next(), "production", NOW);
    const cookie = response.cookies.get(PRODUCTION_CSRF_COOKIE_NAME);

    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.secure).toBe(true);
  });

  it("does not issue an insecure production cookie", () => {
    const request = new NextRequest("http://app.example.com/dashboard");
    const response = applyCsrfCookie(request, NextResponse.next(), "production", NOW);

    expect(response.cookies.getAll()).toEqual([]);
  });

  it("uses the local cookie name for production standalone loopback checks", () => {
    const request = new NextRequest("http://127.0.0.1:3000/simulator");
    const response = applyCsrfCookie(request, NextResponse.next(), "production", NOW);

    expect(response.cookies.get(LOCAL_CSRF_COOKIE_NAME)?.secure).toBeFalsy();
    expect(response.cookies.get(PRODUCTION_CSRF_COOKIE_NAME)).toBeUndefined();
  });

  it("does not rotate a token during a mutation request", () => {
    const request = new NextRequest("https://app.example.com/api/v1/watchlist", {
      headers: { cookie: `${PRODUCTION_CSRF_COOKIE_NAME}=${createCsrfToken()}` },
      method: "POST"
    });
    const response = applyCsrfCookie(request, NextResponse.next(), "production", NOW);

    expect(response.cookies.getAll()).toEqual([]);
  });

  it("rotates the token on each safe response", () => {
    const request = new NextRequest("https://app.example.com/dashboard");
    const first = applyCsrfCookie(request, NextResponse.next(), "production", NOW);
    const second = applyCsrfCookie(request, NextResponse.next(), "production", NOW);

    expect(first.cookies.get(PRODUCTION_CSRF_COOKIE_NAME)?.value).not.toBe(
      second.cookies.get(PRODUCTION_CSRF_COOKIE_NAME)?.value
    );
  });
});

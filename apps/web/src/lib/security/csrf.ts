import { randomBytes } from "node:crypto";
import { type NextRequest, type NextResponse } from "next/server";

export const PRODUCTION_CSRF_COOKIE_NAME = "__Host-rwa-csrf";
export const LOCAL_CSRF_COOKIE_NAME = "rwa-csrf";
export const CSRF_COOKIE_MAX_AGE_SECONDS = 3_600;

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function applyCsrfCookie(
  request: NextRequest,
  response: NextResponse,
  nodeEnvironment: string | undefined,
  now: Date = new Date()
): NextResponse {
  if (!SAFE_METHODS.has(request.method)) return response;

  const isHttps = request.nextUrl.protocol === "https:";
  const isProduction = nodeEnvironment === "production";
  if (isProduction && !isHttps) return response;

  const cookieName = isProduction ? PRODUCTION_CSRF_COOKIE_NAME : LOCAL_CSRF_COOKIE_NAME;

  response.cookies.set({
    expires: new Date(now.getTime() + CSRF_COOKIE_MAX_AGE_SECONDS * 1_000),
    httpOnly: false,
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    name: cookieName,
    path: "/",
    sameSite: "strict",
    secure: isHttps,
    value: createCsrfToken()
  });
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptionsWithName
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export type SupabaseProxyConfiguration = Readonly<{
  anonKey: string;
  secureCookies: boolean;
  url: string;
}>;

export type RequestSecurityContext = Readonly<{
  contentSecurityPolicy: string;
  nonce: string;
}>;

type ClaimsClient = Readonly<{
  auth: Readonly<{
    getClaims: () => Promise<unknown>;
  }>;
}>;

export type ClaimsClientFactory = (
  url: string,
  anonKey: string,
  options: Readonly<{
    cookieOptions: CookieOptionsWithName;
    cookies: CookieMethodsServer;
  }>
) => ClaimsClient;

const createClaimsClient: ClaimsClientFactory = (url, anonKey, options) =>
  createServerClient(url, anonKey, options);

export function readSupabaseProxyConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): SupabaseProxyConfiguration | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (url === undefined || url === "" || anonKey === undefined || anonKey === "") return null;

  try {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      parsedUrl.hostname.includes("*")
    )
      return null;
  } catch {
    return null;
  }

  return { anonKey, secureCookies: environment.NODE_ENV === "production", url };
}

export async function refreshSupabaseSession(
  request: NextRequest,
  security: RequestSecurityContext,
  configuration: SupabaseProxyConfiguration | null,
  clientFactory: ClaimsClientFactory = createClaimsClient
): Promise<NextResponse> {
  const responseCookies: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0] = [];
  const responseHeaders = new Headers();

  const createResponse = (): NextResponse => {
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set("Content-Security-Policy", security.contentSecurityPolicy);
    forwardedHeaders.set("x-nonce", security.nonce);

    const nextResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
    for (const cookie of responseCookies)
      nextResponse.cookies.set(cookie.name, cookie.value, cookie.options);
    for (const [name, value] of responseHeaders) nextResponse.headers.set(name, value);
    nextResponse.headers.set("Content-Security-Policy", security.contentSecurityPolicy);
    return nextResponse;
  };

  let response = createResponse();
  if (configuration === null) return response;

  try {
    const client = clientFactory(configuration.url, configuration.anonKey, {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: configuration.secureCookies
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headersToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          responseCookies.push(...cookiesToSet);
          for (const [name, value] of Object.entries(headersToSet))
            responseHeaders.set(name, value);
          response = createResponse();
        }
      }
    });
    await client.auth.getClaims();
  } catch {
    // Auth provider failure must not remove CSP or make public research pages unavailable.
  }

  return response;
}

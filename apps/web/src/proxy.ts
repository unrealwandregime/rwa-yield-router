import type { NextRequest } from "next/server";
import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce
} from "@/lib/security/content-security-policy";
import { applyCsrfCookie } from "@/lib/security/csrf";
import { readSupabaseProxyConfiguration, refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const supabase = readSupabaseProxyConfiguration(process.env);
  const nonce = createContentSecurityPolicyNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: supabase?.url
  });

  const response = await refreshSupabaseSession(
    request,
    { contentSecurityPolicy, nonce },
    supabase
  );
  return applyCsrfCookie(request, response, process.env.NODE_ENV);
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};

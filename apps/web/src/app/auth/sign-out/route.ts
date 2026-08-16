import { NextResponse, type NextRequest } from "next/server";
import { resolveApplicationUrl, validateBrowserMutation } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!validateBrowserMutation(request.url, request.headers))
    return NextResponse.json(
      { error: { code: "AUTHORIZATION_DENIED", message: "Cross-origin sign-out denied." } },
      { status: 403 }
    );
  const client = await createClient();
  if (client) await client.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/", resolveApplicationUrl(request.url)), 303);
}

import { getServerConfig } from "@rwa-yield-router/config";
import { getDatabase, users } from "@rwa-yield-router/database";
import { NextResponse, type NextRequest } from "next/server";
import { resolveApplicationUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const SAFE_ORIGIN = "https://rwa-yield-router.invalid";

function safePath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.includes("\\")) return "/dashboard";
  try {
    const destination = new URL(value, SAFE_ORIGIN);
    if (destination.origin !== SAFE_ORIGIN) return "/dashboard";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/dashboard";
  }
}

export async function GET(request: NextRequest) {
  const applicationUrl = resolveApplicationUrl(request.url);
  const code = request.nextUrl.searchParams.get("code");
  const destination = safePath(request.nextUrl.searchParams.get("next"));
  const client = await createClient();
  if (!code || !client)
    return NextResponse.redirect(new URL("/auth/sign-in?error=configuration", applicationUrl));
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.user)
    return NextResponse.redirect(new URL("/auth/sign-in?error=callback", applicationUrl));
  if (!getServerConfig().databaseUrl)
    return NextResponse.redirect(new URL("/auth/sign-in?error=configuration", applicationUrl));

  try {
    await getDatabase()
      .insert(users)
      .values({
        authProvider: "supabase",
        authSubjectId: data.user.id,
        email: data.user.email ?? null
      })
      .onConflictDoUpdate({
        target: [users.authProvider, users.authSubjectId],
        set: { email: data.user.email ?? null, updatedAt: new Date() }
      });
  } catch {
    await client.auth.signOut({ scope: "local" });
    return NextResponse.redirect(new URL("/auth/sign-in?error=account", applicationUrl));
  }

  return NextResponse.redirect(new URL(destination, applicationUrl));
}

import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { buildAuthenticationSecurityState } from "@/lib/auth-security";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, options, value } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. Middleware/callback refreshes them instead.
        }
      }
    }
  });
}

export async function getAuthenticatedUser() {
  const client = await createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

export async function getAuthenticatedAssuranceLevel(): Promise<"aal1" | "aal2" | null> {
  return (await getAuthenticatedSecurityState()).assuranceLevel;
}

export async function getAuthenticatedSecurityState() {
  const client = await createClient();
  if (!client)
    return buildAuthenticationSecurityState({
      currentAuthenticationMethods: [],
      currentLevel: null
    });
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error)
    return buildAuthenticationSecurityState({
      currentAuthenticationMethods: [],
      currentLevel: null
    });
  return buildAuthenticationSecurityState({
    currentAuthenticationMethods: data.currentAuthenticationMethods,
    currentLevel: data.currentLevel
  });
}

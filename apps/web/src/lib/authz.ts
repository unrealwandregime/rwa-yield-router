import "server-only";
import { getServerConfig } from "@rwa-yield-router/config";
import {
  getDatabase,
  getUserAuthorizationByAuthSubject,
  users,
  type Database,
  type UserAuthorization
} from "@rwa-yield-router/database";
import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { apiError, checkRateLimit, requestIdentity, validateBrowserMutation } from "@/lib/api";
import { hasRecentAdministratorAuthentication } from "@/lib/auth-security";
import { getAuthenticatedSecurityState, getAuthenticatedUser } from "@/lib/supabase/server";

export type AuthorizedContext = {
  authorization: UserAuthorization;
  database: Database;
  providerUser: User;
};

export type AuthorizationResult =
  { ok: true; value: AuthorizedContext } | { ok: false; response: Response };

export async function authorizePrivateRequest(
  request: NextRequest,
  options: {
    administrator?: boolean;
    mutation?: boolean;
    rateLimit?: number;
    securityAdministrator?: boolean;
  } = {}
): Promise<AuthorizationResult> {
  if (options.mutation && !validateBrowserMutation(request.url, request.headers))
    return {
      ok: false,
      response: apiError(403, "AUTHORIZATION_DENIED", "Browser mutation validation failed.")
    };
  if (
    !(
      await checkRateLimit(
        `private-ip:${requestIdentity(request.headers)}`,
        options.rateLimit ?? 40,
        60_000
      )
    ).allowed
  )
    return {
      ok: false,
      response: apiError(429, "RATE_LIMITED", "Private API rate limit exceeded.")
    };
  if (!getServerConfig().databaseUrl)
    return {
      ok: false,
      response: apiError(
        503,
        "CONFIGURATION_UNAVAILABLE",
        "The account database is not configured."
      )
    };
  const providerUser = await getAuthenticatedUser();
  if (!providerUser)
    return {
      ok: false,
      response: apiError(401, "AUTHENTICATION_REQUIRED", "Sign in is required.")
    };
  try {
    const database = getDatabase();
    await database
      .insert(users)
      .values({
        authProvider: "supabase",
        authSubjectId: providerUser.id,
        email: providerUser.email ?? null
      })
      .onConflictDoUpdate({
        target: [users.authProvider, users.authSubjectId],
        set: { email: providerUser.email ?? null, updatedAt: new Date() }
      });
    const authorization = await getUserAuthorizationByAuthSubject(database, {
      provider: "supabase",
      subjectId: providerUser.id
    });
    if (!authorization || authorization.status !== "ACTIVE")
      return {
        ok: false,
        response: apiError(403, "AUTHORIZATION_DENIED", "The local account is not active.")
      };
    if (
      !(
        await checkRateLimit(
          `private-user:${authorization.userId}`,
          options.rateLimit ?? 40,
          60_000
        )
      ).allowed
    )
      return {
        ok: false,
        response: apiError(429, "RATE_LIMITED", "Account API rate limit exceeded.")
      };
    if (options.administrator && !authorization.isAdministrator)
      return {
        ok: false,
        response: apiError(403, "AUTHORIZATION_DENIED", "Administrator authorization is required.")
      };
    if (options.securityAdministrator && !authorization.isSecurityAdministrator)
      return {
        ok: false,
        response: apiError(
          403,
          "AUTHORIZATION_DENIED",
          "Security-administrator authorization is required."
        )
      };
    if (options.administrator || options.securityAdministrator) {
      const authentication = await getAuthenticatedSecurityState();
      if (authentication.assuranceLevel !== "aal2")
        return {
          ok: false,
          response: apiError(
            403,
            "MFA_REQUIRED",
            "A verified multi-factor session is required for administrator access."
          )
        };
      if (options.mutation && !hasRecentAdministratorAuthentication(authentication))
        return {
          ok: false,
          response: apiError(
            403,
            "RECENT_AUTH_REQUIRED",
            "Repeat multi-factor verification before performing an administrator mutation."
          )
        };
    }
    return { ok: true, value: { authorization, database, providerUser } };
  } catch {
    return {
      ok: false,
      response: apiError(
        503,
        "CONFIGURATION_UNAVAILABLE",
        "Authorization could not be verified safely."
      )
    };
  }
}

export async function authorizeMutation(
  request: NextRequest,
  options: {
    administrator?: boolean;
    rateLimit?: number;
    securityAdministrator?: boolean;
  } = {}
): Promise<AuthorizationResult> {
  return authorizePrivateRequest(request, { ...options, mutation: true });
}

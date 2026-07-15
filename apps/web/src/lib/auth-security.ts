export const ADMIN_RECENT_AUTH_MAX_AGE_MS = 15 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;

export type AuthenticationSecurityState = Readonly<{
  assuranceLevel: "aal1" | "aal2" | null;
  recentAuthenticationAt: Date | null;
}>;

type AuthenticationMethodReference = string | Readonly<{ method: string; timestamp: number }>;

export function buildAuthenticationSecurityState(input: {
  currentLevel: string | null;
  currentAuthenticationMethods: ReadonlyArray<AuthenticationMethodReference>;
}): AuthenticationSecurityState {
  const timestamps = input.currentAuthenticationMethods.flatMap((entry) => {
    if (
      typeof entry === "string" ||
      typeof entry.method !== "string" ||
      entry.method.trim() === "" ||
      !Number.isSafeInteger(entry.timestamp) ||
      entry.timestamp <= 0
    )
      return [];
    return [entry.timestamp * 1_000];
  });
  const latestTimestamp = timestamps.length === 0 ? null : Math.max(...timestamps);

  return {
    assuranceLevel:
      input.currentLevel === "aal2" ? "aal2" : input.currentLevel === "aal1" ? "aal1" : null,
    recentAuthenticationAt: latestTimestamp === null ? null : new Date(latestTimestamp)
  };
}

export function hasRecentAdministratorAuthentication(
  state: AuthenticationSecurityState,
  now: Date = new Date(),
  maximumAgeMs: number = ADMIN_RECENT_AUTH_MAX_AGE_MS
): boolean {
  if (state.assuranceLevel !== "aal2" || state.recentAuthenticationAt === null) return false;
  const ageMs = now.getTime() - state.recentAuthenticationAt.getTime();
  return ageMs >= -MAX_CLOCK_SKEW_MS && ageMs <= maximumAgeMs;
}

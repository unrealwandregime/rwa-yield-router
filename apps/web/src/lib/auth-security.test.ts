import { describe, expect, it } from "vitest";
import {
  buildAuthenticationSecurityState,
  hasRecentAdministratorAuthentication
} from "./auth-security";

describe("administrator authentication security", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("accepts a recent timestamped AAL2 authentication method", () => {
    const state = buildAuthenticationSecurityState({
      currentAuthenticationMethods: [
        { method: "password", timestamp: Date.parse("2026-07-14T11:50:00.000Z") / 1_000 },
        { method: "mfa/totp", timestamp: Date.parse("2026-07-14T11:59:00.000Z") / 1_000 }
      ],
      currentLevel: "aal2"
    });

    expect(state.recentAuthenticationAt?.toISOString()).toBe("2026-07-14T11:59:00.000Z");
    expect(hasRecentAdministratorAuthentication(state, now)).toBe(true);
  });

  it("rejects stale, untimestamped, non-AAL2, and implausibly future authentication", () => {
    const cases = [
      buildAuthenticationSecurityState({
        currentAuthenticationMethods: [
          { method: "mfa/totp", timestamp: Date.parse("2026-07-14T11:40:00.000Z") / 1_000 }
        ],
        currentLevel: "aal2"
      }),
      buildAuthenticationSecurityState({
        currentAuthenticationMethods: ["mfa/totp"],
        currentLevel: "aal2"
      }),
      buildAuthenticationSecurityState({
        currentAuthenticationMethods: [
          { method: "mfa/totp", timestamp: Date.parse("2026-07-14T11:59:00.000Z") / 1_000 }
        ],
        currentLevel: "aal1"
      }),
      buildAuthenticationSecurityState({
        currentAuthenticationMethods: [
          { method: "mfa/totp", timestamp: Date.parse("2026-07-14T12:02:00.000Z") / 1_000 }
        ],
        currentLevel: "aal2"
      })
    ];

    expect(cases.map((state) => hasRecentAdministratorAuthentication(state, now))).toEqual([
      false,
      false,
      false,
      false
    ]);
  });
});

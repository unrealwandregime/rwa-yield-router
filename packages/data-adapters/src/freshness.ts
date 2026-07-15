export type FreshnessClass =
  | "ONCHAIN_STATE"
  | "ORACLE"
  | "DEX_QUOTE"
  | "DEFI_RATE"
  | "VAULT_STATE"
  | "ONCHAIN_TVL"
  | "ISSUER_NAV"
  | "ISSUER_AUM"
  | "CIRCULATION"
  | "PUBLICATION"
  | "LEGAL_METADATA"
  | "HISTORICAL_ROLLUP";

export interface FreshnessPolicy {
  readonly class: FreshnessClass;
  readonly staleAfterMs: number | null;
  readonly description: string;
}

export const defaultFreshnessPolicies: Readonly<Record<FreshnessClass, FreshnessPolicy>> = {
  ONCHAIN_STATE: {
    class: "ONCHAIN_STATE",
    staleAfterMs: 15 * 60_000,
    description: "Three missed five-minute cycles"
  },
  ORACLE: {
    class: "ORACLE",
    staleAfterMs: null,
    description: "Feed-specific heartbeat plus safety margin is required"
  },
  DEX_QUOTE: {
    class: "DEX_QUOTE",
    staleAfterMs: 60_000,
    description: "One minute or earlier block drift"
  },
  DEFI_RATE: {
    class: "DEFI_RATE",
    staleAfterMs: 30 * 60_000,
    description: "Thirty minutes"
  },
  VAULT_STATE: {
    class: "VAULT_STATE",
    staleAfterMs: 60 * 60_000,
    description: "One hour unless withdrawal state invalidates sooner"
  },
  ONCHAIN_TVL: {
    class: "ONCHAIN_TVL",
    staleAfterMs: 2 * 60 * 60_000,
    description: "Two hours"
  },
  ISSUER_NAV: {
    class: "ISSUER_NAV",
    staleAfterMs: null,
    description: "Issuer publication calendar plus one grace cycle"
  },
  ISSUER_AUM: {
    class: "ISSUER_AUM",
    staleAfterMs: null,
    description: "Two missed source-specific publications"
  },
  CIRCULATION: {
    class: "CIRCULATION",
    staleAfterMs: null,
    description: "Two missed source-specific cycles"
  },
  PUBLICATION: {
    class: "PUBLICATION",
    staleAfterMs: null,
    description: "Source-specific attestation publication window"
  },
  LEGAL_METADATA: {
    class: "LEGAL_METADATA",
    staleAfterMs: 14 * 24 * 60 * 60_000,
    description: "Fourteen days or immediate detected content change"
  },
  HISTORICAL_ROLLUP: {
    class: "HISTORICAL_ROLLUP",
    staleAfterMs: 36 * 60 * 60_000,
    description: "Daily rollup with a twelve-hour grace period"
  }
};

export type FreshnessResult =
  | Readonly<{ status: "CURRENT"; ageMs: number }>
  | Readonly<{ status: "STALE"; ageMs: number; overdueByMs: number }>
  | Readonly<{ status: "FUTURE"; ageMs: number }>
  | Readonly<{ status: "POLICY_REQUIRED"; ageMs: number }>;

export function evaluateFreshness(
  observedAt: string,
  policy: FreshnessPolicy,
  now = new Date()
): FreshnessResult {
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) {
    throw new TypeError("Observed timestamp is invalid");
  }
  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < -60_000) {
    return { ageMs, status: "FUTURE" };
  }
  if (policy.staleAfterMs === null) {
    return { ageMs: Math.max(0, ageMs), status: "POLICY_REQUIRED" };
  }
  if (ageMs > policy.staleAfterMs) {
    return {
      ageMs,
      overdueByMs: ageMs - policy.staleAfterMs,
      status: "STALE"
    };
  }
  return { ageMs: Math.max(0, ageMs), status: "CURRENT" };
}

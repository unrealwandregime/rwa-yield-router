import Decimal from "decimal.js";

export const ALERT_CONDITIONS = [
  "APY_ABOVE",
  "APY_BELOW",
  "APY_CHANGE",
  "INCENTIVE_END",
  "TVL_AUM_DECLINE",
  "LIQUIDITY_DETERIORATION",
  "UTILIZATION_SPIKE",
  "NAV_DEVIATION",
  "RISK_SCORE_INCREASE",
  "CONFIDENCE_DOWNGRADE",
  "STALE_DATA",
  "REDEMPTION_CHANGE",
  "ELIGIBILITY_CHANGE",
  "ISSUER_PROTOCOL_WARNING",
  "STABLECOIN_DEPEG",
  "VAULT_ALLOCATION_CHANGE",
  "PRODUCT_STATUS_CHANGE"
] as const;

export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export type AlertSignal =
  | Readonly<{
      availability: "AVAILABLE";
      kind: "NUMERIC";
      current: string;
      previous: string | null;
      observedAt: Date;
      observationKey: string;
      sourceObservationIds: readonly string[];
    }>
  | Readonly<{
      availability: "AVAILABLE";
      kind: "EVENT";
      active: boolean;
      observedAt: Date;
      observationKey: string;
      sourceObservationIds: readonly string[];
    }>
  | Readonly<{
      availability: "UNAVAILABLE";
      reason: string;
    }>;

export type AlertEvaluation =
  | Readonly<{ outcome: "UNAVAILABLE"; reason: string }>
  | Readonly<{ outcome: "NO_TRIGGER" }>
  | Readonly<{
      outcome: "TRIGGERED";
      observedValue: string | null;
      observationKey: string;
      sourceObservationIds: readonly string[];
      observedAt: Date;
    }>;

const requiresEventSignal = (condition: AlertCondition): boolean =>
  condition === "REDEMPTION_CHANGE" ||
  condition === "ELIGIBILITY_CHANGE" ||
  condition === "ISSUER_PROTOCOL_WARNING" ||
  condition === "VAULT_ALLOCATION_CHANGE" ||
  condition === "PRODUCT_STATUS_CHANGE";

const percentageDecline = (current: Decimal, previous: Decimal): Decimal | null => {
  if (previous.lte(0)) return null;
  return previous.minus(current).div(previous).mul(100);
};

export function isAlertCooldownActive(
  lastTriggeredAt: Date | null,
  evaluatedAt: Date,
  cooldownSeconds: number
): boolean {
  return (
    lastTriggeredAt !== null &&
    evaluatedAt.getTime() - lastTriggeredAt.getTime() < cooldownSeconds * 1_000
  );
}

export function evaluateAlertSignal(
  input: Readonly<{
    condition: AlertCondition;
    signal: AlertSignal;
    threshold: string | null;
  }>
): AlertEvaluation {
  if (input.signal.availability === "UNAVAILABLE") {
    return { outcome: "UNAVAILABLE", reason: input.signal.reason };
  }

  if (requiresEventSignal(input.condition)) {
    if (input.signal.kind !== "EVENT") {
      return { outcome: "UNAVAILABLE", reason: "EVENT_SIGNAL_UNAVAILABLE" };
    }
    return input.signal.active
      ? {
          observedAt: input.signal.observedAt,
          observationKey: input.signal.observationKey,
          observedValue: null,
          outcome: "TRIGGERED",
          sourceObservationIds: input.signal.sourceObservationIds
        }
      : { outcome: "NO_TRIGGER" };
  }

  if (input.signal.kind !== "NUMERIC") {
    return { outcome: "UNAVAILABLE", reason: "NUMERIC_SIGNAL_UNAVAILABLE" };
  }
  if (input.threshold === null) {
    return { outcome: "UNAVAILABLE", reason: "THRESHOLD_UNAVAILABLE" };
  }

  const current = new Decimal(input.signal.current);
  const threshold = new Decimal(input.threshold);
  const previous = input.signal.previous === null ? null : new Decimal(input.signal.previous);
  let observed: Decimal;
  let triggered: boolean;

  switch (input.condition) {
    case "APY_ABOVE":
      observed = current;
      triggered = current.gt(threshold);
      break;
    case "APY_BELOW":
      observed = current;
      triggered = current.lt(threshold);
      break;
    case "APY_CHANGE":
    case "RISK_SCORE_INCREASE":
    case "CONFIDENCE_DOWNGRADE": {
      if (previous === null) {
        return { outcome: "UNAVAILABLE", reason: "BASELINE_UNAVAILABLE" };
      }
      observed =
        input.condition === "APY_CHANGE" ? current.minus(previous).abs() : current.minus(previous);
      triggered = observed.gte(threshold);
      break;
    }
    case "TVL_AUM_DECLINE":
    case "LIQUIDITY_DETERIORATION": {
      if (previous === null) {
        return { outcome: "UNAVAILABLE", reason: "BASELINE_UNAVAILABLE" };
      }
      const decline = percentageDecline(current, previous);
      if (decline === null) {
        return { outcome: "UNAVAILABLE", reason: "NON_POSITIVE_BASELINE" };
      }
      observed = decline;
      triggered = decline.gte(threshold);
      break;
    }
    case "INCENTIVE_END":
      observed = current;
      triggered = current.gte(0) && current.lte(threshold);
      break;
    case "UTILIZATION_SPIKE":
    case "NAV_DEVIATION":
    case "STALE_DATA":
    case "STABLECOIN_DEPEG":
      observed = current.abs();
      triggered = observed.gte(threshold);
      break;
    case "REDEMPTION_CHANGE":
    case "ELIGIBILITY_CHANGE":
    case "ISSUER_PROTOCOL_WARNING":
    case "VAULT_ALLOCATION_CHANGE":
    case "PRODUCT_STATUS_CHANGE":
      return { outcome: "UNAVAILABLE", reason: "EVENT_SIGNAL_UNAVAILABLE" };
  }

  if (!triggered) return { outcome: "NO_TRIGGER" };
  return {
    observedAt: input.signal.observedAt,
    observationKey: input.signal.observationKey,
    observedValue: observed.toFixed(),
    outcome: "TRIGGERED",
    sourceObservationIds: input.signal.sourceObservationIds
  };
}

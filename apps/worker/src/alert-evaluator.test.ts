import { describe, expect, it } from "vitest";

import {
  ALERT_CONDITIONS,
  evaluateAlertSignal,
  isAlertCooldownActive,
  type AlertCondition,
  type AlertSignal
} from "./alert-evaluator.js";

const observedAt = new Date("2026-07-14T00:00:00.000Z");
const numeric = (current: string, previous: string | null = null): AlertSignal => ({
  availability: "AVAILABLE",
  current,
  kind: "NUMERIC",
  observationKey: `${current}:${previous ?? "none"}`,
  observedAt,
  previous,
  sourceObservationIds: ["source-current"]
});
const event = (active: boolean): AlertSignal => ({
  active,
  availability: "AVAILABLE",
  kind: "EVENT",
  observationKey: active ? "active" : "inactive",
  observedAt,
  sourceObservationIds: ["event-source"]
});

describe("alert signal evaluator", () => {
  it.each([
    ["APY_ABOVE", numeric("5.01"), "5"],
    ["APY_BELOW", numeric("4.99"), "5"],
    ["APY_CHANGE", numeric("4", "5.5"), "1.5"],
    ["INCENTIVE_END", numeric("6"), "7"],
    ["TVL_AUM_DECLINE", numeric("80", "100"), "20"],
    ["LIQUIDITY_DETERIORATION", numeric("75", "100"), "25"],
    ["UTILIZATION_SPIKE", numeric("92"), "90"],
    ["NAV_DEVIATION", numeric("1.25"), "1"],
    ["RISK_SCORE_INCREASE", numeric("61", "55"), "6"],
    ["CONFIDENCE_DOWNGRADE", numeric("5", "3"), "2"],
    ["STALE_DATA", numeric("25"), "24"],
    ["STABLECOIN_DEPEG", numeric("1.5"), "1"]
  ] satisfies ReadonlyArray<readonly [AlertCondition, AlertSignal, string]>)(
    "triggers %s at its documented boundary",
    (condition, signal, threshold) => {
      expect(evaluateAlertSignal({ condition, signal, threshold }).outcome).toBe("TRIGGERED");
    }
  );

  it.each([
    "REDEMPTION_CHANGE",
    "ELIGIBILITY_CHANGE",
    "ISSUER_PROTOCOL_WARNING",
    "VAULT_ALLOCATION_CHANGE",
    "PRODUCT_STATUS_CHANGE"
  ] satisfies readonly AlertCondition[])("evaluates sourced event condition %s", (condition) => {
    expect(evaluateAlertSignal({ condition, signal: event(true), threshold: null }).outcome).toBe(
      "TRIGGERED"
    );
    expect(evaluateAlertSignal({ condition, signal: event(false), threshold: null }).outcome).toBe(
      "NO_TRIGGER"
    );
  });

  it("distinguishes missing evidence, baseline, and a non-triggering value", () => {
    expect(
      evaluateAlertSignal({
        condition: "APY_ABOVE",
        signal: { availability: "UNAVAILABLE", reason: "NO_CURRENT_APY" },
        threshold: "5"
      })
    ).toEqual({ outcome: "UNAVAILABLE", reason: "NO_CURRENT_APY" });
    expect(
      evaluateAlertSignal({ condition: "APY_CHANGE", signal: numeric("5"), threshold: "1" })
    ).toEqual({ outcome: "UNAVAILABLE", reason: "BASELINE_UNAVAILABLE" });
    expect(
      evaluateAlertSignal({ condition: "APY_ABOVE", signal: numeric("5"), threshold: "5" })
    ).toEqual({ outcome: "NO_TRIGGER" });
  });

  it("covers every persisted alert condition", () => {
    expect(new Set(ALERT_CONDITIONS).size).toBe(17);
  });

  it("applies cooldown to UTC instants with an exact open boundary", () => {
    const lastTriggeredAt = new Date("2026-11-01T05:30:00.000Z");
    expect(
      isAlertCooldownActive(lastTriggeredAt, new Date("2026-11-01T06:29:59.999Z"), 3_600)
    ).toBe(true);
    expect(
      isAlertCooldownActive(lastTriggeredAt, new Date("2026-11-01T06:30:00.000Z"), 3_600)
    ).toBe(false);
    expect(isAlertCooldownActive(null, observedAt, 3_600)).toBe(false);
  });
});

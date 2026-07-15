import { describe, expect, it } from "vitest";

import {
  annualizeTransactionCostRate,
  calculateNetApy,
  calculateYearFraction,
  formatApyForDisplay,
  type YieldCalculationInput,
  type YieldComponent
} from "../src/index.js";

const NOW = "2026-07-13T00:00:00Z";
const OBSERVATION_ID = "10000000-0000-4000-8000-000000000001";

function component(
  id: string,
  value: string,
  overrides: Partial<YieldComponent> = {}
): YieldComponent {
  return {
    id,
    kind: "BASE",
    yieldSourceClass: "MONEY_MARKET_INCOME",
    apy: { status: "CURRENT", value },
    unit: "PERCENTAGE_POINTS_APY",
    compoundingConvention: "SIMPLE_APY",
    performanceFeeEligible: false,
    variable: false,
    promotional: false,
    issuerReported: false,
    startsAt: null,
    endsAt: null,
    observationWindowDays: "90",
    confidence: "DIRECT_API",
    observationIds: [OBSERVATION_ID],
    asOf: NOW,
    ...overrides
  };
}

function input(overrides: Partial<YieldCalculationInput> = {}): YieldCalculationInput {
  return {
    capitalUsd: "10000",
    horizon: {
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2027-01-01T00:00:00Z",
      dayCountConvention: "ACTUAL_365_FIXED"
    },
    components: [component("base", "5")],
    fees: [],
    transactionCosts: [],
    calculatedAt: NOW,
    calculationVersion: "yield-test-v1",
    ...overrides
  };
}

describe("year fractions and transaction-cost annualization", () => {
  it("covers one day, seven days, one month, and one year exactly under ACT/365F", () => {
    expect(
      calculateYearFraction(
        "2026-01-01T00:00:00Z",
        "2026-01-02T00:00:00Z",
        "ACTUAL_365_FIXED"
      ).toString()
    ).toBe("0.002739726027397260274");
    expect(
      calculateYearFraction(
        "2026-01-01T00:00:00Z",
        "2026-01-08T00:00:00Z",
        "ACTUAL_365_FIXED"
      ).toString()
    ).toBe("0.019178082191780821918");
    expect(
      calculateYearFraction(
        "2026-01-01T00:00:00Z",
        "2026-02-01T00:00:00Z",
        "ACTUAL_365_FIXED"
      ).toString()
    ).toBe("0.084931506849315068493");
    expect(
      calculateYearFraction(
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        "ACTUAL_365_FIXED"
      ).toString()
    ).toBe("1");
  });

  it("handles the leap-year boundary under both published conventions", () => {
    expect(
      calculateYearFraction(
        "2024-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
        "ACTUAL_ACTUAL_ISDA"
      ).toString()
    ).toBe("1");
    expect(
      calculateYearFraction(
        "2024-01-01T00:00:00Z",
        "2025-01-01T00:00:00Z",
        "ACTUAL_365_FIXED"
      ).toString()
    ).toBe("1.0027397260273972603");
  });

  it("annualizes fixed costs and rejects invalid capital or horizons", () => {
    expect(
      annualizeTransactionCostRate(
        "100",
        "10000",
        calculateYearFraction("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "ACTUAL_365_FIXED")
      ).toString()
    ).toBe("1");
    expect(() =>
      annualizeTransactionCostRate(
        "1",
        "0",
        calculateYearFraction("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "ACTUAL_365_FIXED")
      )
    ).toThrow("Capital must be a positive");
  });
});

describe("calculateNetApy", () => {
  it.each([
    ["0", "0"],
    ["-2.5", "-2.5"]
  ])("preserves valid zero and negative yield %s", (apy, expected) => {
    const result = calculateNetApy(input({ components: [component("base", apy)] }));
    expect(result.status).toBe("COMPLETE");
    expect(result.netApy).toBe(expected);
  });

  it("keeps base, borrower, Treasury, strategy, reward, and other incentives visible", () => {
    const components = [
      component("base", "1", { kind: "BASE" }),
      component("borrower", "2", {
        kind: "BORROWER_PAID",
        yieldSourceClass: "BORROWER_INTEREST"
      }),
      component("treasury", "3", {
        kind: "TREASURY_OR_MONEY_MARKET",
        yieldSourceClass: "TREASURY_COUPON"
      }),
      component("strategy", "4", { kind: "STRATEGY", yieldSourceClass: "VAULT_STRATEGY" }),
      component("reward", "0.5", {
        kind: "REWARD_TOKEN",
        yieldSourceClass: "TOKEN_INCENTIVE",
        promotional: true,
        endsAt: "2027-01-01T00:00:00Z"
      }),
      component("other", "0.25", {
        kind: "OTHER_INCENTIVE",
        yieldSourceClass: "OTHER_VERIFIED",
        promotional: true,
        endsAt: "2027-01-01T00:00:00Z"
      })
    ];
    const result = calculateNetApy(input({ components }));
    expect(result.grossApy).toBe("10.75");
    expect(result.componentContributions.map((entry) => entry.kind)).toEqual([
      "BASE",
      "BORROWER_PAID",
      "OTHER_INCENTIVE",
      "REWARD_TOKEN",
      "STRATEGY",
      "TREASURY_OR_MONEY_MARKET"
    ]);
  });

  it("fails closed instead of adding incompatible nominal APR", () => {
    const result = calculateNetApy(
      input({ components: [component("apr", "5", { compoundingConvention: "NOMINAL_APR" })] })
    );
    expect(result).toMatchObject({ status: "UNAVAILABLE", reason: "INCOMPATIBLE_COMPONENT" });
  });

  it("subtracts management, protocol, entry, exit, gas, slippage, and positive eligible performance fees", () => {
    const result = calculateNetApy(
      input({
        components: [
          component("eligible-positive", "5", { performanceFeeEligible: true }),
          component("eligible-negative", "-1", { performanceFeeEligible: true })
        ],
        fees: [
          {
            id: "management",
            kind: "MANAGEMENT",
            rate: { status: "CURRENT", value: "0.5" },
            unit: "PERCENTAGE_POINTS_APY",
            observationIds: []
          },
          {
            id: "protocol",
            kind: "PROTOCOL",
            rate: { status: "CURRENT", value: "0.25" },
            unit: "PERCENTAGE_POINTS_APY",
            observationIds: []
          },
          {
            id: "performance",
            kind: "PERFORMANCE",
            rate: { status: "CURRENT", value: "20" },
            unit: "PERCENT_OF_ELIGIBLE_POSITIVE_YIELD",
            observationIds: []
          }
        ],
        transactionCosts: (["ENTRY", "EXIT", "GAS", "SLIPPAGE"] as const).map((kind, index) => ({
          id: kind.toLowerCase(),
          kind,
          amount: { status: "CURRENT" as const, value: "25" },
          unit: "USD" as const,
          estimated: index === 3,
          observationIds: []
        }))
      })
    );
    expect(result.grossApy).toBe("4");
    expect(result.recurringFeeApy).toBe("0.75");
    expect(result.expectedPerformanceFeeApy).toBe("1");
    expect(result.annualizedTransactionCostApy).toBe("1");
    expect(result.netApy).toBe("1.25");
    expect(result.status).toBe("QUALIFIED");
  });

  it("returns a partial known-cost result when a fee is unknown rather than assuming zero", () => {
    const result = calculateNetApy(
      input({
        fees: [
          {
            id: "unknown-management",
            kind: "MANAGEMENT",
            rate: { status: "UNKNOWN" },
            unit: "PERCENTAGE_POINTS_APY",
            observationIds: []
          }
        ]
      })
    );
    expect(result).toMatchObject({
      status: "PARTIAL",
      grossApy: "5",
      knownNetApy: "5",
      netApy: null,
      missingInputIds: ["unknown-management"]
    });
    expect(result.warnings).toContain("UNKNOWN_FEE");
  });

  it("marks stale, estimated, variable, short-window, and issuer-reported values as qualified", () => {
    const result = calculateNetApy(
      input({
        components: [
          component("qualified", "5", {
            apy: { status: "STALE", value: "5" },
            variable: true,
            issuerReported: true,
            observationWindowDays: "7"
          })
        ]
      })
    );
    expect(result.status).toBe("QUALIFIED");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "STALE_INPUT",
        "VARIABLE_YIELD",
        "ISSUER_REPORTED_YIELD",
        "SHORT_OBSERVATION_WINDOW"
      ])
    );
  });

  it("handles expired, mid-horizon, and unknown-end incentives", () => {
    const expired = calculateNetApy(
      input({
        components: [
          component("reward", "10", {
            kind: "REWARD_TOKEN",
            promotional: true,
            endsAt: "2025-12-31T00:00:00Z"
          })
        ]
      })
    );
    expect(expired.grossApy).toBe("0");
    expect(expired.warnings).toContain("INCENTIVE_EXPIRED");

    const halfway = calculateNetApy(
      input({
        components: [
          component("reward", "10", {
            kind: "REWARD_TOKEN",
            promotional: true,
            endsAt: "2026-07-02T12:00:00Z"
          })
        ]
      })
    );
    expect(halfway.grossApy).toBe("5");
    expect(halfway.warnings).toContain("INCENTIVE_ENDS_DURING_HORIZON");

    const unknownEnd = calculateNetApy(
      input({
        components: [
          component("reward", "10", {
            kind: "REWARD_TOKEN",
            promotional: true,
            endsAt: null
          })
        ]
      })
    );
    expect(unknownEnd.grossApy).toBe("10");
    expect(unknownEnd.warnings).toContain("INCENTIVE_END_UNKNOWN");
  });

  it("allows costs to make a small-capital result negative", () => {
    const result = calculateNetApy(
      input({
        capitalUsd: "10",
        transactionCosts: [
          {
            id: "gas",
            kind: "GAS",
            amount: { status: "ESTIMATED", value: "2" },
            unit: "USD",
            estimated: true,
            observationIds: []
          }
        ]
      })
    );
    expect(result.netApy).toBe("-15");
  });

  it("returns unavailable when every yield component is missing", () => {
    const result = calculateNetApy(
      input({ components: [component("missing", "0", { apy: { status: "UNAVAILABLE" } })] })
    );
    expect(result).toMatchObject({ status: "UNAVAILABLE", reason: "NO_AVAILABLE_YIELD" });
  });

  it("rejects zero/negative capital and non-positive horizons at the schema boundary", () => {
    expect(() => calculateNetApy(input({ capitalUsd: "0" }))).toThrow();
    expect(() =>
      calculateNetApy(
        input({
          horizon: {
            startsAt: "2026-01-01T00:00:00Z",
            endsAt: "2026-01-01T00:00:00Z",
            dayCountConvention: "ACTUAL_365_FIXED"
          }
        })
      )
    ).toThrow();
  });

  it("rejects negative fees and transaction costs rather than treating them as yield", () => {
    expect(() =>
      calculateNetApy(
        input({
          fees: [
            {
              id: "negative-fee",
              kind: "MANAGEMENT",
              rate: { status: "CURRENT", value: "-1" },
              unit: "PERCENTAGE_POINTS_APY",
              observationIds: []
            }
          ]
        })
      )
    ).toThrow();
    expect(() =>
      calculateNetApy(
        input({
          transactionCosts: [
            {
              id: "negative-cost",
              kind: "ENTRY",
              amount: { status: "CURRENT", value: "-1" },
              unit: "USD",
              estimated: false,
              observationIds: []
            }
          ]
        })
      )
    ).toThrow();
  });

  it("is deterministic and input-array order independent", () => {
    const components = [component("b", "2"), component("a", "3")];
    const first = calculateNetApy(input({ components }));
    const second = calculateNetApy(input({ components: [...components].reverse() }));
    expect(second).toEqual(first);
    expect(first.calculationVersion).toBe("yield-test-v1");
    expect(first.inputHash).toMatch(/^fnv1a64:/);
  });

  it("preserves ranking precision while display rounding stays separate", () => {
    const result = calculateNetApy(input({ components: [component("base", "5.123456789")] }));
    expect(result.netApy).toBe("5.123456789");
    expect(formatApyForDisplay(result.knownNetApy ?? "0")).toBe("5.12");
  });

  it("satisfies cost and horizon monotonic invariants across deterministic cases", () => {
    for (const cost of ["1", "10", "100", "500"]) {
      const lowerCost = calculateNetApy(
        input({
          transactionCosts: [
            {
              id: "cost",
              kind: "ENTRY",
              amount: { status: "CURRENT", value: cost },
              unit: "USD",
              estimated: false,
              observationIds: []
            }
          ]
        })
      );
      const higherCost = calculateNetApy(
        input({
          transactionCosts: [
            {
              id: "cost",
              kind: "ENTRY",
              amount: { status: "CURRENT", value: `${Number(cost) + 1}` },
              unit: "USD",
              estimated: false,
              observationIds: []
            }
          ]
        })
      );
      expect(Number(higherCost.knownNetApy)).toBeLessThan(Number(lowerCost.knownNetApy));
    }

    const sevenDays = calculateNetApy(
      input({
        horizon: {
          startsAt: "2026-01-01T00:00:00Z",
          endsAt: "2026-01-08T00:00:00Z",
          dayCountConvention: "ACTUAL_365_FIXED"
        },
        transactionCosts: [
          {
            id: "cost",
            kind: "ENTRY",
            amount: { status: "CURRENT", value: "10" },
            unit: "USD",
            estimated: false,
            observationIds: []
          }
        ]
      })
    );
    const oneYear = calculateNetApy(
      input({
        transactionCosts: [
          {
            id: "cost",
            kind: "ENTRY",
            amount: { status: "CURRENT", value: "10" },
            unit: "USD",
            estimated: false,
            observationIds: []
          }
        ]
      })
    );
    expect(Number(sevenDays.annualizedTransactionCostApy)).toBeGreaterThan(
      Number(oneYear.annualizedTransactionCostApy)
    );
  });
});

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_WEIGHTS_V1,
  PENALTY_GROUP_FACTORS,
  RISK_FACTORS,
  RISK_METHODOLOGY_V1,
  RiskEngineError,
  calculateCompositeRisk,
  calculateRiskAdjustedApy,
  classifyRiskBand,
  publishMethodology,
  riskMethodologySchema,
  scoreRiskFactor,
  type RiskFactorResult,
  type RiskMethodology
} from "../src/index.js";

const NOW = "2026-07-13T00:00:00Z";
const OBSERVATION_ID = "10000000-0000-4000-8000-000000000001";

function factor(
  factorId: (typeof RISK_FACTORS)[number],
  score: string,
  overrides: Partial<Extract<RiskFactorResult, { status: "AVAILABLE" }>> = {}
): Extract<RiskFactorResult, { status: "AVAILABLE" }> {
  return {
    factor: factorId,
    status: "AVAILABLE",
    score,
    explanation: `${factorId} is calculated from sourced test-only evidence.`,
    inputMetrics: [`${factorId.toLowerCase()}-metric`],
    sourceObservationIds: [OBSERVATION_ID],
    confidence: "DIRECT_API",
    evidenceCoveragePct: "100",
    calculatedAt: NOW,
    methodologyVersion: "1.0.0",
    ...overrides
  };
}

function allFactors(score: string): RiskFactorResult[] {
  return RISK_FACTORS.map((factorId) => factor(factorId, score));
}

describe("factor scoring", () => {
  it("calculates weighted input scores with decimal arithmetic and retains evidence", () => {
    const result = scoreRiskFactor({
      factor: "LIQUIDITY",
      metrics: [
        {
          id: "depth",
          score: { status: "CURRENT", value: "20" },
          weight: "2",
          required: true,
          observationIds: [OBSERVATION_ID]
        },
        {
          id: "slippage",
          score: { status: "CURRENT", value: "80" },
          weight: "1",
          required: true,
          observationIds: [OBSERVATION_ID]
        }
      ],
      minimumCoveragePct: "70",
      explanation: "Depth carries twice the weight of slippage.",
      confidence: "DIRECT_API",
      calculatedAt: NOW,
      methodologyVersion: "1.0.0"
    });
    expect(result).toMatchObject({
      status: "AVAILABLE",
      score: "40",
      evidenceCoveragePct: "100",
      sourceObservationIds: [OBSERVATION_ID]
    });
  });

  it("keeps a factor unavailable when a required input is missing or coverage is too low", () => {
    const result = scoreRiskFactor({
      factor: "CUSTODY",
      metrics: [
        {
          id: "segregation",
          score: { status: "UNAVAILABLE" },
          weight: "80",
          required: true,
          observationIds: []
        },
        {
          id: "insurance",
          score: { status: "CURRENT", value: "5" },
          weight: "20",
          required: false,
          observationIds: [OBSERVATION_ID]
        }
      ],
      minimumCoveragePct: "70",
      explanation: "Required custody evidence is missing.",
      confidence: "UNAVAILABLE",
      calculatedAt: NOW,
      methodologyVersion: "1.0.0"
    });
    expect(result).toMatchObject({ status: "UNAVAILABLE", score: null, evidenceCoveragePct: "20" });
  });

  it.each(["-0.01", "100.01"])(
    "rejects factor input outside the zero-to-100 boundary: %s",
    (score) => {
      expect(() =>
        scoreRiskFactor({
          factor: "LIQUIDITY",
          metrics: [
            {
              id: "bad",
              score: { status: "CURRENT", value: score },
              weight: "100",
              required: true,
              observationIds: []
            }
          ],
          minimumCoveragePct: "70",
          explanation: "Boundary validation.",
          confidence: "DIRECT_API",
          calculatedAt: NOW,
          methodologyVersion: "1.0.0"
        })
      ).toThrow();
    }
  );
});

describe("published v1 methodology", () => {
  it("has all sixteen factors and exact 100% totals for all six categories", () => {
    expect(RISK_FACTORS).toHaveLength(16);
    expect(Object.keys(CATEGORY_WEIGHTS_V1)).toHaveLength(6);
    for (const weights of Object.values(CATEGORY_WEIGHTS_V1)) {
      const total = Object.values(weights).reduce(
        (sum, weight) => sum.plus(weight),
        new Decimal(0)
      );
      expect(total.toString()).toBe("100");
    }
  });

  it("maps each factor into exactly one visible penalty group", () => {
    const grouped = Object.values(PENALTY_GROUP_FACTORS).flat();
    expect(grouped).toHaveLength(RISK_FACTORS.length);
    expect(new Set(grouped).size).toBe(RISK_FACTORS.length);
    expect(new Set(grouped)).toEqual(new Set(RISK_FACTORS));
  });

  it("publishes a validated deep-frozen copy and rejects republishing immutable history", () => {
    const draft: RiskMethodology = riskMethodologySchema.parse({
      ...structuredClone(RISK_METHODOLOGY_V1),
      id: "10000000-0000-4000-8000-000000000202",
      semanticVersion: "1.1.0",
      status: "DRAFT",
      publishedAt: null,
      effectiveAt: null,
      reviewerId: null,
      releaseNotes: "Test-only future methodology."
    });
    const published = publishMethodology(draft, {
      reviewerId: "independent-reviewer",
      publishedAt: NOW,
      effectiveAt: NOW
    });
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.categoryWeights.TOKENIZED_TBILL)).toBe(true);
    expect(published.status).toBe("PUBLISHED");
    expect(() =>
      publishMethodology(published, {
        reviewerId: "another-reviewer",
        publishedAt: NOW,
        effectiveAt: NOW
      })
    ).toThrow(RiskEngineError);
  });
});

describe("calculateCompositeRisk", () => {
  it.each([
    ["0", "LOW"],
    ["20", "LOW"],
    ["21", "LOW_TO_MODERATE"],
    ["40", "LOW_TO_MODERATE"],
    ["41", "MODERATE"],
    ["60", "MODERATE"],
    ["61", "HIGH"],
    ["80", "HIGH"],
    ["81", "VERY_HIGH"],
    ["100", "VERY_HIGH"]
  ])("classifies score %s in the published band %s", (score, code) => {
    expect(classifyRiskBand(score).code).toBe(code);
  });

  it("selects category-specific weights and calculates exact composites", () => {
    const result = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("60"),
      calculatedAt: NOW
    });
    expect(result).toMatchObject({
      status: "VERIFIED",
      score: "60.00",
      category: "CASH_EQUIVALENT",
      methodologyVersion: "1.0.0",
      evidenceCoveragePct: "100.00"
    });
    expect(result.factors.find((entry) => entry.factor === "LIQUIDITY")?.weightPct).toBe("15");
  });

  it("uses the visible 75 proxy without changing an unavailable factor into an observed score", () => {
    const inputs = allFactors("0").filter((entry) => entry.factor !== "LIQUIDITY");
    inputs.push({
      ...factor("LIQUIDITY", "0"),
      status: "UNAVAILABLE",
      score: null,
      confidence: "UNAVAILABLE",
      evidenceCoveragePct: "0"
    });
    const result = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: inputs,
      calculatedAt: NOW
    });
    const liquidity = result.factors.find((entry) => entry.factor === "LIQUIDITY");
    expect(result.status).toBe("PROVISIONAL");
    expect(result.score).toBe("11.25");
    expect(liquidity).toMatchObject({
      status: "UNAVAILABLE",
      score: null,
      effectiveScore: "75",
      usedUnknownProxy: true,
      weightPct: "15"
    });
  });

  it("does not renormalize around missing evidence and makes low coverage unavailable", () => {
    const inputs = allFactors("10");
    inputs[0] = factor("LIQUIDITY", "1", { evidenceCoveragePct: "69" });
    const result = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: inputs,
      calculatedAt: NOW
    });
    expect(result.factors[0]).toMatchObject({
      status: "UNAVAILABLE",
      effectiveScore: "75",
      weightPct: "15"
    });
    expect(result.score).toBe("19.75");
  });

  it("marks zero-weight category factors not applicable rather than zero risk", () => {
    const result = calculateCompositeRisk({
      category: "TOKENIZED_TBILL",
      factors: allFactors("100"),
      calculatedAt: NOW
    });
    expect(result.factors.find((entry) => entry.factor === "STABLECOIN_OR_DEPEG")).toMatchObject({
      status: "NOT_APPLICABLE",
      score: null,
      effectiveScore: null,
      weightPct: "0"
    });
    expect(result.factors.find((entry) => entry.factor === "INCENTIVE_DEPENDENCY")).toMatchObject({
      status: "NOT_APPLICABLE"
    });
  });

  it("replays identical historical inputs deterministically", () => {
    const input = {
      category: "DEFI_LENDING" as const,
      factors: allFactors("33.333333"),
      calculatedAt: NOW
    };
    expect(calculateCompositeRisk(input)).toEqual(calculateCompositeRisk(input));
  });
});

describe("calculateRiskAdjustedApy", () => {
  it("returns every visible penalty and the exact quadratic result", () => {
    const composite = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("60"),
      calculatedAt: NOW
    });
    const result = calculateRiskAdjustedApy({ netApy: "8", compositeRisk: composite });
    expect(result.status).toBe("AVAILABLE");
    if (result.status === "AVAILABLE" || result.status === "PROVISIONAL") {
      expect(result.label).toBe("Comparative risk-adjusted APY");
      expect(result.totalPenaltyPp).toBe("4.32");
      expect(result.comparativeRiskAdjustedApy).toBe("3.68");
      expect(Object.keys(result.penalties)).toEqual(Object.keys(PENALTY_GROUP_FACTORS));
      expect(result.penalties.liquidityPenalty).toMatchObject({
        groupSeverity: "60",
        groupWeightSharePct: "15",
        penaltyPp: "0.648"
      });
    }
  });

  it("bounds the full v1 penalty at 12 percentage points", () => {
    const composite = calculateCompositeRisk({
      category: "STABLECOIN_VAULT",
      factors: allFactors("100"),
      calculatedAt: NOW
    });
    const result = calculateRiskAdjustedApy({ netApy: "0", compositeRisk: composite });
    expect(result).toMatchObject({
      status: "AVAILABLE",
      totalPenaltyPp: "12",
      comparativeRiskAdjustedApy: "-12"
    });
  });

  it.each(["0", "-5", "1000"])("supports extreme, zero, and negative net APY %s", (netApy) => {
    const composite = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("0"),
      calculatedAt: NOW
    });
    const result = calculateRiskAdjustedApy({ netApy, compositeRisk: composite });
    expect(result).toMatchObject({ status: "AVAILABLE", comparativeRiskAdjustedApy: netApy });
  });

  it("is unavailable when net APY is missing and provisional for stale net APY or factor evidence", () => {
    const verified = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("10"),
      calculatedAt: NOW
    });
    expect(
      calculateRiskAdjustedApy({ netApy: { status: "UNAVAILABLE" }, compositeRisk: verified })
    ).toMatchObject({
      status: "UNAVAILABLE",
      comparativeRiskAdjustedApy: null
    });
    expect(
      calculateRiskAdjustedApy({ netApy: { status: "STALE", value: "5" }, compositeRisk: verified })
    ).toMatchObject({ status: "PROVISIONAL" });

    const provisional = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("10").slice(1),
      calculatedAt: NOW
    });
    expect(calculateRiskAdjustedApy({ netApy: "5", compositeRisk: provisional })).toMatchObject({
      status: "PROVISIONAL"
    });
  });

  it("does not let lower evidence improve a normal low-risk adjusted APY", () => {
    const complete = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("10"),
      calculatedAt: NOW
    });
    const incomplete = calculateCompositeRisk({
      category: "CASH_EQUIVALENT",
      factors: allFactors("10").slice(1),
      calculatedAt: NOW
    });
    const completeAdjusted = calculateRiskAdjustedApy({ netApy: "8", compositeRisk: complete });
    const incompleteAdjusted = calculateRiskAdjustedApy({ netApy: "8", compositeRisk: incomplete });
    if (
      completeAdjusted.comparativeRiskAdjustedApy !== null &&
      incompleteAdjusted.comparativeRiskAdjustedApy !== null
    ) {
      expect(
        new Decimal(incompleteAdjusted.comparativeRiskAdjustedApy).lte(
          completeAdjusted.comparativeRiskAdjustedApy
        )
      ).toBe(true);
    }
  });
});

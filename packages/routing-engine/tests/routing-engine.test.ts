import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  ANALYTICAL_SIMULATION_DISCLOSURE,
  PROFILE_CONSTRAINTS,
  expandProfileConstraints,
  optimizePortfolio,
  revalidateAllocation,
  simulationInputSchema,
  type OptimizationRequest,
  type RouteCandidate,
  type SimulationInputRequest
} from "../src/index.js";

const NOW = "2026-07-13T00:00:00Z";
const OBSERVATION_ID = "10000000-0000-4000-8000-000000000001";

function simulation(overrides: Partial<SimulationInputRequest> = {}): SimulationInputRequest {
  return {
    capitalUsd: "10000",
    currentAssetId: "USD",
    currentChainId: "chain-a",
    holdingPeriodDays: "365",
    jurisdiction: "IN",
    investorClassification: "RETAIL",
    kycAcceptable: true,
    preferredChains: [],
    excludedChains: [],
    preferredAssets: [],
    profile: "CUSTOM",
    constraintOverrides: {},
    minimumAumOrTvlUsd: "0",
    minimumAvailableLiquidityUsd: "0",
    incentiveYieldAcceptable: true,
    minimumDataConfidence: "THIRD_PARTY",
    excludedProductIds: [],
    excludedProtocolIds: [],
    excludedIssuerIds: [],
    advancedResearchMode: false,
    asOf: NOW,
    calculationVersion: "routing-test-v1",
    methodologyVersion: "1.0.0",
    ...overrides
  };
}

function candidate(
  routeId: string,
  adjustedApy: string,
  overrides: Partial<RouteCandidate> = {}
): RouteCandidate {
  return {
    routeId,
    productId: `product-${routeId}`,
    issuerId: `issuer-${routeId}`,
    protocolId: `protocol-${routeId}`,
    chainId: `chain-${routeId}`,
    category: "CASH_EQUIVALENT",
    underlyingAssetId: `asset-${routeId}`,
    stablecoinId: null,
    isDefi: false,
    isRwa: false,
    isGold: false,
    grossApy: new Decimal(adjustedApy).plus(1).toString(),
    netApyBeforeTransactionCosts: new Decimal(adjustedApy).plus("0.5").toString(),
    comparativeRiskAdjustedApyBeforeTransactionCosts: adjustedApy,
    riskScore: "20",
    aumOrTvlUsd: "10000000",
    availableLiquidityUsd: "1000000",
    liquidity: {
      immediatePct: "100",
      within24HoursPct: "100",
      within7DaysPct: "100"
    },
    incentiveApy: "0",
    yieldSourceBreakdown: [{ sourceClass: "MONEY_MARKET_INCOME", sharePct: "100" }],
    lifecycle: "PUBLISHED",
    dataStatus: "CURRENT",
    verified: true,
    confidence: "DIRECT_API",
    eligibility: {
      status: "ELIGIBLE",
      jurisdictions: ["*"],
      investorClassifications: [
        "RETAIL",
        "ACCREDITED",
        "QUALIFIED",
        "PROFESSIONAL",
        "INSTITUTIONAL"
      ]
    },
    kyc: "NOT_REQUIRED",
    transactionCosts: {
      defaultFixedCostUsd: "0",
      defaultSlippageBps: "0",
      overrides: []
    },
    sourceObservationIds: [OBSERVATION_ID],
    dataTimestamp: NOW,
    methodologyVersion: "1.0.0",
    ...overrides
  };
}

function request(
  candidates: RouteCandidate[],
  inputOverrides: Partial<SimulationInputRequest> = {}
): OptimizationRequest {
  return { input: simulation(inputOverrides), candidates };
}

describe("profile expansion and boundary validation", () => {
  it("expands all five profiles into visible canonical constraints", () => {
    for (const profile of [
      "CAPITAL_PRESERVATION",
      "CONSERVATIVE",
      "BALANCED",
      "YIELD_SEEKING",
      "CUSTOM"
    ] as const) {
      const expanded = expandProfileConstraints(profile);
      expect(expanded).toEqual(PROFILE_CONSTRAINTS[profile]);
      expect(Object.keys(expanded)).toHaveLength(13);
    }
  });

  it("applies explicit overrides without mutating the preset", () => {
    const before = structuredClone(PROFILE_CONSTRAINTS.BALANCED);
    const expanded = expandProfileConstraints("BALANCED", { maxProductAllocationPct: "33" });
    expect(expanded.maxProductAllocationPct).toBe("33");
    expect(PROFILE_CONSTRAINTS.BALANCED).toEqual(before);
  });

  it("rejects zero capital, non-positive horizons, and inconsistent liquidity minima", () => {
    expect(simulationInputSchema.safeParse(simulation({ capitalUsd: "0" })).success).toBe(false);
    expect(simulationInputSchema.safeParse(simulation({ holdingPeriodDays: "0" })).success).toBe(
      false
    );
    expect(() =>
      expandProfileConstraints("CUSTOM", {
        minImmediateLiquidityPct: "80",
        min24HourLiquidityPct: "50"
      })
    ).toThrow();
  });
});

describe("deterministic constrained optimization", () => {
  it("returns one exact 100% analytical allocation with complete provenance", async () => {
    const result = await optimizePortfolio(request([candidate("a", "5")]));
    expect(result.status).toBe("FEASIBLE");
    if (result.status === "FEASIBLE") {
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]?.allocationPct).toBe("100");
      expect(result.metrics.comparativeRiskAdjustedApy).toBe("5");
      expect(result.disclosure).toBe(ANALYTICAL_SIMULATION_DISCLOSURE);
      expect(result.inputHash).toMatch(/^fnv1a64:/);
      expect(result.candidateSnapshotHash).toMatch(/^fnv1a64:/);
      expect(result.resultHash).toMatch(/^fnv1a64:/);
      expect(result.solverVersion).toBe("highs-js-1.14.2");
      expect(result.calculationVersion).toBe("routing-test-v1");
      expect(result.methodologyVersion).toBe("1.0.0");
      expect(result.allocations[0]?.sourceObservationIds).toEqual([OBSERVATION_ID]);
    }
  });

  it("enforces product, issuer, protocol, chain, category, stablecoin, DeFi, RWA, and gold caps", async () => {
    const concentrated = candidate("high", "10", {
      category: "GOLD_BACKED_TOKEN",
      stablecoinId: "stablecoin-high",
      isDefi: true,
      isRwa: true,
      isGold: true
    });
    const diversifier = candidate("low", "5", { category: "CASH_EQUIVALENT" });
    const result = await optimizePortfolio(
      request([concentrated, diversifier], {
        constraintOverrides: {
          maxProductAllocationPct: "50",
          maxIssuerExposurePct: "50",
          maxProtocolExposurePct: "50",
          maxChainExposurePct: "50",
          maxCategoryAllocationPct: "50",
          maxStablecoinExposurePct: "50",
          maxDefiExposurePct: "50",
          maxRwaExposurePct: "50",
          maxGoldExposurePct: "50"
        }
      })
    );
    expect(result.status).toBe("FEASIBLE");
    if (result.status === "FEASIBLE") {
      const allocations = Object.fromEntries(
        result.allocations.map((allocation) => [allocation.routeId, allocation.allocationPct])
      );
      expect(new Decimal(allocations.high ?? "0").minus(50).abs().lte("0.000001")).toBe(true);
      expect(new Decimal(allocations.low ?? "0").minus(50).abs().lte("0.000001")).toBe(true);
      expect(result.metrics.exposure).toMatchObject({
        stablecoinPct: allocations.high,
        defiPct: allocations.high,
        rwaPct: allocations.high,
        goldPct: allocations.high
      });
      expect(result.metrics.exposure.byIssuer[concentrated.issuerId]).toBe(allocations.high);
      expect(result.metrics.exposure.byProtocol[concentrated.protocolId ?? ""]).toBe(
        allocations.high
      );
      expect(result.metrics.exposure.byChain[concentrated.chainId]).toBe(allocations.high);
      expect(result.metrics.exposure.byCategory.GOLD_BACKED_TOKEN).toBe(allocations.high);
    }
  });

  it("satisfies immediate, 24-hour, and seven-day minimums instead of chasing the highest APY", async () => {
    const illiquid = candidate("illiquid", "10", {
      liquidity: { immediatePct: "0", within24HoursPct: "20", within7DaysPct: "50" }
    });
    const liquid = candidate("liquid", "5");
    const result = await optimizePortfolio(
      request([illiquid, liquid], {
        constraintOverrides: {
          minImmediateLiquidityPct: "60",
          min24HourLiquidityPct: "70",
          min7DayLiquidityPct: "80"
        }
      })
    );
    expect(result.status).toBe("FEASIBLE");
    if (result.status === "FEASIBLE") {
      expect(new Decimal(result.metrics.liquidity.immediatePct).gte("59.999999")).toBe(true);
      expect(new Decimal(result.metrics.liquidity.within24HoursPct).gte("69.999999")).toBe(true);
      expect(new Decimal(result.metrics.liquidity.within7DaysPct).gte("79.999999")).toBe(true);
    }
  });

  it("enforces weighted risk and route capacity from available liquidity", async () => {
    const risky = candidate("risky", "10", {
      riskScore: "90",
      availableLiquidityUsd: "5000"
    });
    const lowerRisk = candidate("lower-risk", "4", { riskScore: "10" });
    const result = await optimizePortfolio(
      request([risky, lowerRisk], {
        constraintOverrides: { maxWeightedRiskScore: "50" }
      })
    );
    expect(result.status).toBe("FEASIBLE");
    if (result.status === "FEASIBLE") {
      const riskyAllocation = result.allocations.find(
        (allocation) => allocation.routeId === "risky"
      );
      expect(new Decimal(riskyAllocation?.allocationPct ?? "0").lte("50.000001")).toBe(true);
      expect(new Decimal(result.metrics.weightedRiskScore).lte("50.000001")).toBe(true);
    }
  });

  it("is byte-equivalent for candidate/input order and uses stable route-ID tie breaking", async () => {
    const a = candidate("a", "5");
    const b = candidate("b", "5");
    const first = await optimizePortfolio(
      request([b, a], { preferredChains: ["unused", "chain-a"], preferredAssets: ["unused"] })
    );
    const second = await optimizePortfolio(
      request([a, b], { preferredChains: ["chain-a", "unused"], preferredAssets: ["unused"] })
    );
    expect(first).toEqual(second);
    expect(first.status).toBe("FEASIBLE");
    if (first.status === "FEASIBLE") {
      expect(first.allocations[0]?.routeId).toBe("a");
      expect(first.allocations[0]?.allocationPct).toBe("100");
      expect(first.allocations[0]?.rationaleCodes).toContain("PREFERRED_CHAIN");
    }
  });

  it("recalculates route costs for capital, horizon, current asset, and current chain", async () => {
    const route = candidate("costed", "8", {
      transactionCosts: {
        defaultFixedCostUsd: "100",
        defaultSlippageBps: "0",
        overrides: [
          {
            originAssetId: "USD",
            originChainId: "chain-a",
            fixedCostUsd: "10",
            slippageBps: "0"
          }
        ]
      }
    });
    const baseline = await optimizePortfolio(request([route]));
    const moreCapital = await optimizePortfolio(request([route], { capitalUsd: "100000" }));
    const shorter = await optimizePortfolio(request([route], { holdingPeriodDays: "36.5" }));
    const otherOrigin = await optimizePortfolio(
      request([route], { currentAssetId: "USDC", currentChainId: "chain-z" })
    );
    for (const result of [baseline, moreCapital, shorter, otherOrigin]) {
      expect(result.status).toBe("FEASIBLE");
    }
    if (
      baseline.status === "FEASIBLE" &&
      moreCapital.status === "FEASIBLE" &&
      shorter.status === "FEASIBLE" &&
      otherOrigin.status === "FEASIBLE"
    ) {
      expect(baseline.allocations[0]?.annualizedTransactionCostApy).toBe("0.1");
      expect(moreCapital.allocations[0]?.annualizedTransactionCostApy).toBe("0.01");
      expect(shorter.allocations[0]?.annualizedTransactionCostApy).toBe("1");
      expect(otherOrigin.allocations[0]?.annualizedTransactionCostApy).toBe("1");
      expect(baseline.allocations[0]?.rationaleCodes).toContain("COST_SCENARIO_ASSET_AND_CHAIN");
      expect(otherOrigin.allocations[0]?.rationaleCodes).toContain("COST_SCENARIO_DEFAULT");
    }
  });
});

describe("fail-closed exclusions and diagnostics", () => {
  it("excludes lifecycle, freshness, verification, eligibility, KYC, confidence, scale, incentives, and explicit blocks", async () => {
    const eligible = candidate("eligible", "4");
    const excluded = [
      candidate("paused", "9", { lifecycle: "PAUSED" }),
      candidate("stale", "9", { dataStatus: "STALE", confidence: "STALE" }),
      candidate("unverified", "9", { verified: false }),
      candidate("unknown-eligibility", "9", {
        eligibility: { status: "UNKNOWN", jurisdictions: [], investorClassifications: [] }
      }),
      candidate("kyc", "9", { kyc: "REQUIRED" }),
      candidate("weak-confidence", "9", { confidence: "ESTIMATED" }),
      candidate("small", "9", { aumOrTvlUsd: "5", availableLiquidityUsd: "5" }),
      candidate("incentive", "9", { incentiveApy: "2" }),
      candidate("explicit", "9", {
        productId: "blocked-product",
        protocolId: "blocked-protocol",
        issuerId: "blocked-issuer",
        chainId: "blocked-chain"
      })
    ];
    const result = await optimizePortfolio(
      request([eligible, ...excluded], {
        kycAcceptable: false,
        minimumDataConfidence: "THIRD_PARTY",
        minimumAumOrTvlUsd: "10",
        minimumAvailableLiquidityUsd: "10",
        incentiveYieldAcceptable: false,
        excludedProductIds: ["blocked-product"],
        excludedProtocolIds: ["blocked-protocol"],
        excludedIssuerIds: ["blocked-issuer"],
        excludedChains: ["blocked-chain"],
        advancedResearchMode: true
      })
    );
    expect(result.status).toBe("FEASIBLE");
    if (result.status === "FEASIBLE") {
      expect(result.allocations.map((allocation) => allocation.routeId)).toEqual(["eligible"]);
      const reasons = new Set(result.excludedCandidates.flatMap((entry) => entry.reasonCodes));
      for (const expectedReason of [
        "LIFECYCLE_NOT_PUBLISHED",
        "DATA_STALE",
        "ROUTE_UNVERIFIED",
        "ELIGIBILITY_UNKNOWN",
        "KYC_NOT_ACCEPTED",
        "CONFIDENCE_BELOW_MINIMUM",
        "SCALE_BELOW_MINIMUM",
        "LIQUIDITY_BELOW_MINIMUM",
        "INCENTIVE_NOT_ACCEPTED",
        "PRODUCT_EXCLUDED",
        "PROTOCOL_EXCLUDED",
        "ISSUER_EXCLUDED",
        "CHAIN_EXCLUDED"
      ] as const) {
        expect(reasons.has(expectedReason)).toBe(true);
      }
    }
  });

  it("returns no allocation and a deterministic minimal cap relaxation", async () => {
    const original = request([candidate("only", "5", { issuerId: "single-issuer" })], {
      constraintOverrides: { maxIssuerExposurePct: "40" }
    });
    const before = structuredClone(original);
    const result = await optimizePortfolio(original);
    expect(original).toEqual(before);
    expect(result.status).toBe("INFEASIBLE");
    if (result.status === "INFEASIBLE") {
      expect(result.allocations).toEqual([]);
      expect(result.diagnostics.summary).toBe("No feasible allocation satisfies all constraints.");
      expect(result.diagnostics.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "ISSUER_CAP",
            currentValue: "40",
            suggestedValue: "100",
            relaxationPct: "60"
          })
        ])
      );
    }
  });

  it("returns stable exclusion diagnostics when every route fails a hard gate", async () => {
    const result = await optimizePortfolio(
      request([candidate("closed", "5", { lifecycle: "CLOSED" })])
    );
    expect(result.status).toBe("INFEASIBLE");
    if (result.status === "INFEASIBLE") {
      expect(result.allocations).toEqual([]);
      expect(result.diagnostics.exclusionCounts).toEqual({ LIFECYCLE_NOT_PUBLISHED: 1 });
      expect(result.diagnostics.conflicts[0]).toMatchObject({
        code: "LIFECYCLE_NOT_PUBLISHED",
        currentValue: "1"
      });
    }
  });

  it("independently rejects allocation totals and negative solver values beyond tolerance", () => {
    expect(revalidateAllocation([new Decimal("99.999")], [])).toEqual([
      expect.objectContaining({ code: "ALLOCATION_TOTAL" })
    ]);
    expect(revalidateAllocation([new Decimal("100.01"), new Decimal("-0.01")], [])).toEqual([
      expect.objectContaining({ code: "NEGATIVE_ALLOCATION" })
    ]);
  });
});

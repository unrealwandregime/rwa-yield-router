import { describe, expect, it } from "vitest";
import type {
  ExcludedCandidate,
  PortfolioAllocation,
  RouteCandidate
} from "@rwa-yield-router/routing-engine";
import {
  buildAllocationPersistenceRows,
  buildCandidatePersistenceRows
} from "./simulation-persistence";

function candidate(routeId: string): RouteCandidate {
  return {
    aumOrTvlUsd: "1000000",
    availableLiquidityUsd: "500000",
    category: "TOKENIZED_TBILL",
    chainId: "ethereum",
    comparativeRiskAdjustedApyBeforeTransactionCosts: "3.5",
    confidence: "VERIFIED_OFFICIAL",
    dataStatus: "CURRENT",
    dataTimestamp: "2026-07-18T08:00:00.000Z",
    eligibility: {
      investorClassifications: ["RETAIL"],
      jurisdictions: ["US"],
      status: "ELIGIBLE"
    },
    grossApy: "5",
    incentiveApy: "0",
    isDefi: false,
    isGold: false,
    isRwa: true,
    issuerId: "issuer-a",
    kyc: "NOT_REQUIRED",
    lifecycle: "PUBLISHED",
    liquidity: { immediatePct: "50", within24HoursPct: "75", within7DaysPct: "100" },
    methodologyVersion: "risk-v1.0.0",
    netApyBeforeTransactionCosts: "4.5",
    productId: `product-${routeId}`,
    protocolId: null,
    riskScore: "20",
    routeId,
    sourceObservationIds: ["00000000-0000-4000-8000-000000000001"],
    stablecoinId: null,
    transactionCosts: {
      defaultFixedCostUsd: "0",
      defaultSlippageBps: "0",
      overrides: [],
      status: "AVAILABLE"
    },
    underlyingAssetId: "usd",
    verified: true,
    yieldSourceBreakdown: [{ sharePct: "100", sourceClass: "TREASURY_COUPON" }]
  };
}

function allocation(routeId: string, allocationPct: string): PortfolioAllocation {
  return {
    allocationPct,
    annualizedTransactionCostApy: "0",
    comparativeRiskAdjustedApy: "3.5",
    comparativeRiskAdjustedApyBeforeTransactionCosts: "3.5",
    estimatedTransactionCostUsd: "0",
    grossApy: "5",
    netApy: "4.5",
    netApyBeforeTransactionCosts: "4.5",
    productId: `product-${routeId}`,
    rationaleCodes: ["RISK_ADJUSTED_YIELD"],
    riskScore: "20",
    routeId,
    sourceObservationIds: ["00000000-0000-4000-8000-000000000001"],
    transactionCostStatus: "AVAILABLE"
  };
}

describe("simulation persistence rows", () => {
  it("retains deterministic candidate facts and real database route identifiers", () => {
    const exclusions: ExcludedCandidate[] = [
      {
        facts: { dataStatus: "STALE" },
        productId: "product-route-b",
        reasonCodes: ["DATA_STALE"],
        routeId: "route-b"
      }
    ];
    const rows = buildCandidatePersistenceRows(
      "simulation-id",
      [candidate("route-b"), candidate("route-a")],
      exclusions,
      new Map([
        ["route-a", "00000000-0000-4000-8000-00000000000a"],
        ["route-b", "00000000-0000-4000-8000-00000000000b"]
      ])
    );

    expect(rows.map((row) => [row.ordinal, row.routeId, row.included])).toEqual([
      [1, "00000000-0000-4000-8000-00000000000a", true],
      [2, "00000000-0000-4000-8000-00000000000b", false]
    ]);
    expect(rows[1]?.canonicalFacts.exclusionReasonCodes).toEqual(["DATA_STALE"]);
  });

  it("persists exact allocation ratios and amounts", () => {
    const rows = buildAllocationPersistenceRows(
      "simulation-id",
      "1234.56",
      [allocation("route-b", "40"), allocation("route-a", "60")],
      new Map([
        ["route-a", "00000000-0000-4000-8000-00000000000a"],
        ["route-b", "00000000-0000-4000-8000-00000000000b"]
      ])
    );

    expect(rows.map((row) => [row.allocationRatio, row.allocatedAmount])).toEqual([
      ["0.6", "740.736"],
      ["0.4", "493.824"]
    ]);
  });

  it("rejects incomplete route mappings and invalid allocation totals", () => {
    expect(() =>
      buildCandidatePersistenceRows("simulation-id", [candidate("route-a")], [], new Map())
    ).toThrow(/canonical route/u);
    expect(() =>
      buildAllocationPersistenceRows(
        "simulation-id",
        "100",
        [allocation("route-a", "99")],
        new Map([["route-a", "00000000-0000-4000-8000-00000000000a"]])
      )
    ).toThrow(/100 percent/u);
  });
});

import { RISK_METHODOLOGY_V1 } from "@rwa-yield-router/risk-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalog, type CatalogRecord } from "@/lib/catalog";
import type { PersistedRouteEvidence } from "@/lib/public-read-model";

const { getEffectivePublicReadModelMock } = vi.hoisted(() => ({
  getEffectivePublicReadModelMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/public-read-model", () => ({
  getEffectivePublicReadModel: getEffectivePublicReadModelMock
}));

import { buildSimulationCandidates } from "@/lib/simulation-candidates";

const OBSERVATION_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004"
] as const;
const AT = "2026-07-18T00:00:00.000Z";

const metricState = (status: "CURRENT" | "ESTIMATED") => ({
  confidence: status === "ESTIMATED" ? "UNAVAILABLE" : "DIRECT_API",
  observedAt: AT,
  status
});

const methodology = {
  calculationVersion: "risk-engine-v1.0.0",
  description: "Test methodology",
  methodology: RISK_METHODOLOGY_V1,
  source: "STATIC_FALLBACK" as const
};

function fixtureRecord(): CatalogRecord {
  const record = getCatalog().find((candidate) => candidate.publicationStatus === "PUBLISHED");
  if (record === undefined) throw new Error("Published catalog fixture is missing");
  return {
    ...record,
    aumTvlUsd: "999999",
    grossApy: "99",
    liquidityUsd: "999999",
    methodologyVersion: RISK_METHODOLOGY_V1.semanticVersion,
    netApy: "99",
    observedAt: AT,
    riskAdjustedApy: "99",
    riskScore: "1",
    sourceObservationIds: ["20000000-0000-4000-8000-000000000001"]
  };
}

function persistedFixture(record: CatalogRecord): PersistedRouteEvidence {
  return {
    aumOrTvlUsd: "1000",
    aumState: metricState("CURRENT"),
    availableLiquidityUsd: "500",
    category: record.category,
    chainId: "eip155:8453",
    comparativeRiskAdjustedApy: "3.25",
    databaseRouteId: "30000000-0000-4000-8000-000000000001",
    eligibility: {
      investorClassifications: ["RETAIL"],
      jurisdictions: ["IN"],
      status: "ELIGIBLE"
    },
    grossApy: "5",
    incentiveApy: "0.5",
    issuerId: "issuer-1",
    kyc: "NOT_REQUIRED",
    lifecycle: "PUBLISHED",
    liquidityAmounts: {
      immediate: "500",
      within24Hours: null,
      within7Days: null
    },
    liquidityState: metricState("CURRENT"),
    methodologyVersion: RISK_METHODOLOGY_V1.semanticVersion,
    metricObservationIds: {
      aumTvl: [OBSERVATION_IDS[1]],
      liquidity: [OBSERVATION_IDS[2]],
      risk: [OBSERVATION_IDS[3]],
      yield: [OBSERVATION_IDS[0]]
    },
    netApy: "4.5",
    productId: "product-1",
    protocolId: "protocol-1",
    riskScore: "75",
    riskState: metricState("ESTIMATED"),
    routeSlug: record.slug,
    sourceObservationIds: OBSERVATION_IDS,
    stablecoinId: "usdc",
    underlyingAssetId: "usdc",
    yieldSourceClasses: [record.yieldSource],
    yieldState: metricState("CURRENT")
  };
}

beforeEach(() => {
  getEffectivePublicReadModelMock.mockReset();
});

describe("simulation candidate provenance", () => {
  it("does not admit catalog or request-time values without persisted route evidence", async () => {
    const record = fixtureRecord();
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [record],
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map()
    });

    await expect(buildSimulationCandidates()).resolves.toEqual([]);
  });

  it("uses only complete persisted values and their matching observation IDs", async () => {
    const record = { ...fixtureRecord(), sourceObservationIds: OBSERVATION_IDS };
    const persisted = persistedFixture(record);
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [record],
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map([[record.slug, persisted]])
    });

    const [candidate] = await buildSimulationCandidates();
    expect(candidate).toMatchObject({
      aumOrTvlUsd: "1000",
      availableLiquidityUsd: "500",
      confidence: "ESTIMATED",
      dataStatus: "ESTIMATED",
      grossApy: "5",
      liquidity: {
        immediatePct: "50",
        within24HoursPct: "50",
        within7DaysPct: "50"
      },
      netApyBeforeTransactionCosts: "4.5",
      riskScore: "75",
      routeId: record.slug,
      sourceObservationIds: [...OBSERVATION_IDS],
      verified: true
    });
    expect(candidate?.sourceObservationIds).toEqual(record.sourceObservationIds);
  });

  it("rejects persisted values when the catalog references different observations", async () => {
    const record = fixtureRecord();
    const persisted = persistedFixture(record);
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [record],
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map([[record.slug, persisted]])
    });

    await expect(buildSimulationCandidates()).resolves.toEqual([]);
  });

  it("rejects persisted metric values when complete observation coverage is absent", async () => {
    const record = {
      ...fixtureRecord(),
      sourceObservationIds: OBSERVATION_IDS.slice(0, 3)
    };
    const persisted = {
      ...persistedFixture(record),
      metricObservationIds: {
        ...persistedFixture(record).metricObservationIds,
        risk: []
      },
      sourceObservationIds: OBSERVATION_IDS.slice(0, 3)
    };
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [record],
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map([[record.slug, persisted]])
    });

    await expect(buildSimulationCandidates()).resolves.toEqual([]);
  });
});

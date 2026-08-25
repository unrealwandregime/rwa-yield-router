import { MORPHO_PRODUCTION_ROUTES } from "@rwa-yield-router/data-adapters";
import { RISK_METHODOLOGY_V1 } from "@rwa-yield-router/risk-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog } from "@/lib/catalog";

const { getEffectivePublicReadModelMock } = vi.hoisted(() => ({
  getEffectivePublicReadModelMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/public-read-model", () => ({
  getEffectivePublicReadModel: getEffectivePublicReadModelMock
}));

import {
  annotatePersistedMorphoProviderFailure,
  fetchLiveMorphoEvidence,
  getLiveCatalog,
  getOfficialProviderStatus
} from "@/lib/live-morpho";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  getEffectivePublicReadModelMock.mockReset();
});

describe("request-time Morpho evidence", () => {
  it("does not relabel fresh persisted observations as stale when a request-time refresh fails", () => {
    const identity = MORPHO_PRODUCTION_ROUTES[0];
    if (identity === undefined) throw new Error("Morpho route fixture is missing");
    const record = getCatalog().find((candidate) => candidate.slug === identity.routeSlug);
    if (record === undefined) throw new Error("Catalog route fixture is missing");
    const currentState = {
      confidence: "DIRECT_API",
      observedAt: "2026-08-25T07:37:03.335Z",
      status: "CURRENT" as const
    };
    const persistedRecord = {
      ...record,
      confidence: "DIRECT_API",
      metricStatus: {
        aumTvl: currentState,
        liquidity: currentState,
        risk: { ...currentState, confidence: "ESTIMATED", status: "ESTIMATED" as const },
        yield: currentState
      },
      observedAt: currentState.observedAt,
      warnings: []
    };
    const [annotated] = annotatePersistedMorphoProviderFailure({
      catalog: [persistedRecord],
      persistedEvidenceBySlug: new Map([
        [
          persistedRecord.slug,
          {
            aumState: currentState,
            liquidityState: currentState,
            methodologyVersion: RISK_METHODOLOGY_V1.semanticVersion,
            riskState: persistedRecord.metricStatus.risk,
            yieldState: currentState
          }
        ]
      ])
    });

    expect(annotated?.confidence).toBe("DIRECT_API");
    expect(annotated?.metricStatus.yield.status).toBe("CURRENT");
    expect(annotated?.metricStatus.risk.status).toBe("ESTIMATED");
    expect(annotated?.warnings).toEqual([
      expect.stringContaining("retain their independently evaluated freshness status")
    ]);
  });

  it("never calls the provider when request-time fetching is explicitly disabled", async () => {
    const [catalogRecord] = getCatalog();
    if (catalogRecord === undefined) throw new Error("Catalog route fixture is missing");
    const fetchImplementation = vi.fn<typeof fetch>();
    vi.stubEnv("REQUEST_TIME_PROVIDER_FETCH_ENABLED", "false");
    vi.stubGlobal("fetch", fetchImplementation);
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [catalogRecord],
      databaseState: "ABSENT",
      methodology: {
        calculationVersion: "risk-engine-v1.0.0",
        description: "Test methodology",
        methodology: RISK_METHODOLOGY_V1,
        source: "STATIC_FALLBACK"
      },
      persistedEvidenceBySlug: new Map()
    });

    await expect(getLiveCatalog()).resolves.toEqual([catalogRecord]);
    await expect(getOfficialProviderStatus()).resolves.toMatchObject({
      errorCategory: "PROVIDER_FETCH_DISABLED",
      state: "UNAVAILABLE"
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("has no fabricated observation IDs and classifies empty-factor risk as estimated", async () => {
    const identity = MORPHO_PRODUCTION_ROUTES[0];
    if (identity === undefined) throw new Error("Morpho route fixture is missing");
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            vaults: {
              items: [
                {
                  address: identity.contractAddress,
                  chain: { id: identity.chainId },
                  liquidity: { usd: "500" },
                  state: {
                    apy: "0.05",
                    fee: "0.1",
                    netApy: "0.045",
                    netApyExcludingRewards: "0.04",
                    totalAssetsUsd: "1000"
                  }
                }
              ]
            }
          }
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );
    const dependencies = {
      fetchImplementation,
      resolver: async () => [{ address: "93.184.216.34", family: 4 as const }]
    };

    const [evidence, coalescedEvidence] = await Promise.all([
      fetchLiveMorphoEvidence(RISK_METHODOLOGY_V1, dependencies),
      fetchLiveMorphoEvidence(RISK_METHODOLOGY_V1, dependencies)
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(coalescedEvidence).toEqual(evidence);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      netApy: "4.5",
      netApyClassification: "PROVIDER_REPORTED_BEFORE_USER_TRANSACTION_COSTS",
      riskEvidenceCoveragePct: "0.00",
      riskScore: "75.00",
      riskStatus: "ESTIMATED",
      riskUsesUnknownProxy: true,
      unknownRiskProxy: "75"
    });
    expect(evidence[0]?.unavailableRiskFactors.length).toBeGreaterThan(0);
    expect(evidence[0]).not.toHaveProperty("sourceObservationIds");
    vi.stubGlobal("fetch", fetchImplementation);

    const catalogFixture = getCatalog().find((record) => record.slug === identity.routeSlug);
    if (catalogFixture === undefined) throw new Error("Catalog route fixture is missing");
    const catalogRecord = {
      ...catalogFixture,
      grossApy: null,
      netApy: null,
      riskAdjustedApy: null,
      riskScore: null
    };
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [catalogRecord],
      databaseState: "ABSENT",
      methodology: {
        calculationVersion: "risk-engine-v1.0.0",
        description: "Test methodology",
        methodology: RISK_METHODOLOGY_V1,
        source: "STATIC_FALLBACK"
      },
      persistedEvidenceBySlug: new Map()
    });

    const [overlaid] = await getLiveCatalog();
    if (overlaid === undefined) throw new Error("Live overlay fixture is missing");
    expect(overlaid.sourceObservationIds).toEqual([]);
    expect(overlaid.metricStatus.risk).toMatchObject({
      confidence: "ESTIMATED",
      status: "ESTIMATED"
    });
    expect(overlaid.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not assigned database observation IDs"),
        expect.stringContaining("provider-reported net APY"),
        expect.stringContaining("0.00% evidence coverage")
      ])
    );

    const currentState = {
      confidence: "DIRECT_API",
      observedAt: overlaid.observedAt,
      status: "CURRENT" as const
    };
    if (currentState.observedAt === null) throw new Error("Live overlay timestamp is missing");
    const persistedRecord = {
      ...overlaid,
      metricStatus: {
        aumTvl: currentState,
        liquidity: currentState,
        risk: currentState,
        yield: currentState
      },
      sourceObservationIds: [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000003"
      ],
      warnings: []
    };
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [persistedRecord],
      databaseState: "HEALTHY",
      methodology: {
        calculationVersion: "risk-engine-v1.0.0",
        description: "Test methodology",
        methodology: RISK_METHODOLOGY_V1,
        source: "STATIC_FALLBACK"
      },
      persistedEvidenceBySlug: new Map([
        [
          persistedRecord.slug,
          {
            aumState: currentState,
            liquidityState: currentState,
            methodologyVersion: RISK_METHODOLOGY_V1.semanticVersion,
            riskState: currentState,
            yieldState: currentState
          }
        ]
      ])
    });

    const [unchanged] = await getLiveCatalog();
    expect(unchanged).toBe(persistedRecord);
    expect(unchanged?.sourceObservationIds).toEqual(persistedRecord.sourceObservationIds);
    expect(unchanged?.warnings).toEqual([]);

    const estimatedRiskState = {
      confidence: "UNAVAILABLE",
      observedAt: currentState.observedAt,
      status: "ESTIMATED" as const
    };
    const persistedEstimatedRiskRecord = {
      ...persistedRecord,
      metricStatus: { ...persistedRecord.metricStatus, risk: estimatedRiskState },
      warnings: ["Persisted provisional risk evidence remains estimated."]
    };
    getEffectivePublicReadModelMock.mockResolvedValue({
      catalog: [persistedEstimatedRiskRecord],
      databaseState: "HEALTHY",
      methodology: {
        calculationVersion: "risk-engine-v1.0.0",
        description: "Test methodology",
        methodology: RISK_METHODOLOGY_V1,
        source: "STATIC_FALLBACK"
      },
      persistedEvidenceBySlug: new Map([
        [
          persistedEstimatedRiskRecord.slug,
          {
            aumState: currentState,
            liquidityState: currentState,
            methodologyVersion: RISK_METHODOLOGY_V1.semanticVersion,
            riskState: estimatedRiskState,
            yieldState: currentState
          }
        ]
      ])
    });

    const [preservedEstimatedRisk] = await getLiveCatalog();
    expect(preservedEstimatedRisk).toBe(persistedEstimatedRiskRecord);
    expect(preservedEstimatedRisk?.warnings).toEqual(persistedEstimatedRiskRecord.warnings);
  });
});

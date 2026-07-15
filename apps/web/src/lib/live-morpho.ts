import "server-only";

import { MORPHO_API_URL, MORPHO_PRODUCTION_ROUTES } from "@rwa-yield-router/data-adapters";
import {
  calculateCompositeRisk,
  calculateRiskAdjustedApy,
  type RiskMethodology
} from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { z } from "zod";
import type { CatalogMetricState, CatalogRecord } from "@/lib/catalog";
import {
  getEffectivePublicReadModel,
  type EffectivePublicReadModel
} from "@/lib/public-read-model";

const decimalLike = z
  .union([z.string(), z.number().finite()])
  .transform((value) => String(value))
  .refine((value) => /^-?\d+(?:\.\d+)?$/u.test(value), "Expected a plain decimal");

const morphoResponseSchema = z.object({
  data: z.object({
    vaults: z.object({
      items: z.array(
        z.object({
          address: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
          chain: z.object({ id: z.number().int().positive() }),
          liquidity: z.object({ usd: decimalLike.nullable() }).nullable(),
          state: z.object({
            apy: decimalLike.nullable(),
            fee: decimalLike.nullable(),
            netApy: decimalLike.nullable(),
            netApyExcludingRewards: decimalLike.nullable(),
            totalAssetsUsd: decimalLike.nullable()
          })
        })
      )
    })
  }),
  errors: z.array(z.object({ message: z.string() })).optional()
});

const MORPHO_QUERY = `query ProductionVaults {
  vaults(first: 1000, where: { chainId_in: [1, 8453] }) {
    items {
      address
      chain { id }
      state { apy netApy netApyExcludingRewards totalAssetsUsd fee }
      liquidity { usd }
    }
  }
}`;

export interface LiveMorphoEvidence {
  readonly routeSlug: string;
  readonly chainId: string;
  readonly contractAddress: string;
  readonly grossApy: string;
  readonly netApy: string;
  readonly comparativeRiskAdjustedApy: string | null;
  readonly riskScore: string | null;
  readonly aumOrTvlUsd: string;
  readonly availableLiquidityUsd: string;
  readonly immediateLiquidityPct: string;
  readonly incentiveApy: string;
  readonly sourceObservationIds: readonly [string, string, string];
  readonly dataTimestamp: string;
  readonly methodologyVersion: string | null;
}

export type OfficialProviderErrorCategory =
  | "DATABASE_UNAVAILABLE"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "PROVIDER_REJECTED"
  | "TIMEOUT";

export interface OfficialProviderStatus {
  readonly providerCode: "MORPHO_OFFICIAL_GRAPHQL";
  readonly state: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  readonly checkedAt: string;
  readonly routesExpected: number;
  readonly routesAvailable: number;
  readonly routesStale: number;
  readonly latestObservedAt: string | null;
  readonly errorCategory: OfficialProviderErrorCategory | null;
}

interface LiveCache {
  readonly expiresAt: number;
  readonly evidence: ReadonlyArray<LiveMorphoEvidence>;
  readonly methodologyVersion: string | null;
}

interface ProviderFailureCache {
  readonly category: OfficialProviderErrorCategory;
  readonly expiresAt: number;
  readonly methodologyVersion: string | null;
}

class OfficialProviderError extends Error {
  readonly category: OfficialProviderErrorCategory;

  constructor(category: OfficialProviderErrorCategory) {
    super("Official provider evidence could not be loaded");
    this.name = "OfficialProviderError";
    this.category = category;
  }
}

let liveCache: LiveCache | undefined;
let providerFailureCache: ProviderFailureCache | undefined;
let lastProviderStatus: OfficialProviderStatus | undefined;

const percentagePoints = (ratio: string): string =>
  new Decimal(ratio).mul(100).toDecimalPlaces(12).toString();

const boundedLiquidityPercent = (liquidity: string, tvl: string): string => {
  const denominator = new Decimal(tvl);
  if (denominator.lte(0)) return "0";
  return Decimal.min(100, new Decimal(liquidity).div(denominator).mul(100))
    .toDecimalPlaces(8)
    .toString();
};

const classifyProviderFailure = (error: unknown): OfficialProviderErrorCategory => {
  if (error instanceof OfficialProviderError) return error.category;
  if (error instanceof DOMException && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "INVALID_RESPONSE";
  return "NETWORK_ERROR";
};

const cachedProviderFailure = (
  category: OfficialProviderErrorCategory,
  methodologyVersion: string | null
): OfficialProviderError => {
  providerFailureCache = {
    category,
    expiresAt: Date.now() + 60_000,
    methodologyVersion
  };
  return new OfficialProviderError(category);
};

export async function fetchLiveMorphoEvidence(
  methodology: RiskMethodology | null = null
): Promise<ReadonlyArray<LiveMorphoEvidence>> {
  const now = Date.now();
  const methodologyVersion = methodology?.semanticVersion ?? null;
  if (
    liveCache &&
    liveCache.expiresAt > now &&
    liveCache.methodologyVersion === methodologyVersion
  ) {
    return liveCache.evidence;
  }
  if (
    providerFailureCache &&
    providerFailureCache.expiresAt > now &&
    providerFailureCache.methodologyVersion === methodologyVersion
  ) {
    throw new OfficialProviderError(providerFailureCache.category);
  }

  const response = await fetch(MORPHO_API_URL, {
    body: JSON.stringify({ query: MORPHO_QUERY }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(3_000)
  }).catch((error: unknown) => {
    throw cachedProviderFailure(classifyProviderFailure(error), methodologyVersion);
  });
  if (!response.ok) throw cachedProviderFailure("HTTP_ERROR", methodologyVersion);

  const parsed = morphoResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw cachedProviderFailure("INVALID_RESPONSE", methodologyVersion);
  if (parsed.data.errors && parsed.data.errors.length > 0)
    throw cachedProviderFailure("PROVIDER_REJECTED", methodologyVersion);

  const byIdentity = new Map(
    parsed.data.data.vaults.items.map((item) => [
      `${item.chain.id}:${item.address.toLowerCase()}`,
      item
    ])
  );
  const fetchedAt = new Date().toISOString();
  const evidence: LiveMorphoEvidence[] = [];

  for (const identity of MORPHO_PRODUCTION_ROUTES) {
    const item = byIdentity.get(`${identity.chainId}:${identity.contractAddress.toLowerCase()}`);
    const grossRatio = item?.state.apy;
    const netRatio = item?.state.netApy;
    const netExcludingRewards = item?.state.netApyExcludingRewards;
    const tvl = item?.state.totalAssetsUsd;
    const liquidity = item?.liquidity?.usd;
    if (!item || !grossRatio || !netRatio || !netExcludingRewards || !tvl || !liquidity) continue;

    const grossApy = percentagePoints(grossRatio);
    const netApy = percentagePoints(netRatio);
    const compositeRisk =
      methodology === null
        ? null
        : calculateCompositeRisk({
            calculatedAt: fetchedAt,
            category: "STABLECOIN_VAULT",
            factors: [],
            methodology
          });
    const riskAdjusted =
      compositeRisk === null || methodology === null
        ? null
        : calculateRiskAdjustedApy({ compositeRisk, methodology, netApy });

    evidence.push({
      aumOrTvlUsd: tvl,
      availableLiquidityUsd: liquidity,
      chainId: String(identity.chainId),
      comparativeRiskAdjustedApy:
        riskAdjusted === null || riskAdjusted.status === "UNAVAILABLE"
          ? null
          : riskAdjusted.comparativeRiskAdjustedApy,
      contractAddress: identity.contractAddress,
      dataTimestamp: fetchedAt,
      grossApy,
      immediateLiquidityPct: boundedLiquidityPercent(liquidity, tvl),
      incentiveApy: Decimal.max(0, new Decimal(netRatio).minus(netExcludingRewards).mul(100))
        .toDecimalPlaces(12)
        .toString(),
      methodologyVersion,
      netApy,
      riskScore: compositeRisk?.score ?? null,
      routeSlug: identity.routeSlug,
      sourceObservationIds: identity.observationIds
    });
  }

  liveCache = { evidence, expiresAt: now + 5 * 60_000, methodologyVersion };
  providerFailureCache = undefined;
  return evidence;
}

const currentMetricState = (at: string): CatalogMetricState => ({
  confidence: "DIRECT_API",
  observedAt: at,
  status: "CURRENT"
});

const staleMetricState = (state: CatalogMetricState): CatalogMetricState =>
  state.observedAt === null ? state : { ...state, confidence: "STALE", status: "STALE" };

const stalePersistedMorphoRecords = (model: EffectivePublicReadModel): readonly CatalogRecord[] => {
  const canonical = new Set(MORPHO_PRODUCTION_ROUTES.map((route) => route.routeSlug));
  return model.catalog.map((record) => {
    if (!canonical.has(record.slug) || !model.persistedEvidenceBySlug.has(record.slug))
      return record;
    return {
      ...record,
      confidence: "STALE",
      metricStatus: {
        aumTvl: staleMetricState(record.metricStatus.aumTvl),
        liquidity: staleMetricState(record.metricStatus.liquidity),
        risk: staleMetricState(record.metricStatus.risk),
        yield: staleMetricState(record.metricStatus.yield)
      },
      warnings: [
        ...record.warnings,
        "The official Morpho provider is unavailable; last persisted values are retained and marked stale."
      ]
    };
  });
};

const overlayLiveEvidence = (
  model: EffectivePublicReadModel,
  evidence: readonly LiveMorphoEvidence[]
): CatalogRecord[] => {
  const bySlug = new Map(evidence.map((item) => [item.routeSlug, item]));
  return model.catalog.map((record) => {
    const live = bySlug.get(record.slug);
    if (!live || record.publicationStatus !== "PUBLISHED") return record;
    const persisted = model.persistedEvidenceBySlug.get(record.slug);
    const persistedYieldCurrent = persisted?.yieldState.status === "CURRENT";
    const persistedAumCurrent = persisted?.aumState.status === "CURRENT";
    const persistedLiquidityCurrent = persisted?.liquidityState.status === "CURRENT";
    const persistedRiskCurrent =
      persisted?.riskState.status === "CURRENT" &&
      persisted.methodologyVersion === live.methodologyVersion;
    const yieldUsesLive =
      !persistedYieldCurrent || record.grossApy === null || record.netApy === null;
    const aumUsesLive = !persistedAumCurrent || record.aumTvlUsd === null;
    const liquidityUsesLive = !persistedLiquidityCurrent || record.liquidityUsd === null;
    const riskUsesLive =
      !persistedRiskCurrent || record.riskScore === null || record.riskAdjustedApy === null;
    const metricStatus = {
      aumTvl: aumUsesLive ? currentMetricState(live.dataTimestamp) : record.metricStatus.aumTvl,
      liquidity: liquidityUsesLive
        ? currentMetricState(live.dataTimestamp)
        : record.metricStatus.liquidity,
      risk:
        riskUsesLive && live.riskScore !== null
          ? currentMetricState(live.dataTimestamp)
          : record.metricStatus.risk,
      yield: yieldUsesLive ? currentMetricState(live.dataTimestamp) : record.metricStatus.yield
    } satisfies CatalogRecord["metricStatus"];
    const observedAt =
      Object.values(metricStatus)
        .flatMap((state) => (state.observedAt === null ? [] : [state.observedAt]))
        .sort((left, right) => right.localeCompare(left))[0] ?? record.observedAt;
    return {
      ...record,
      aumTvlUsd: aumUsesLive ? live.aumOrTvlUsd : record.aumTvlUsd,
      confidence: yieldUsesLive ? "DIRECT_API" : record.confidence,
      grossApy: yieldUsesLive ? live.grossApy : record.grossApy,
      liquidityUsd: liquidityUsesLive ? live.availableLiquidityUsd : record.liquidityUsd,
      methodologyVersion: live.methodologyVersion,
      metricStatus,
      netApy: yieldUsesLive ? live.netApy : record.netApy,
      observedAt,
      riskAdjustedApy: riskUsesLive ? live.comparativeRiskAdjustedApy : record.riskAdjustedApy,
      riskScore: riskUsesLive ? live.riskScore : record.riskScore,
      source: yieldUsesLive
        ? { name: "Morpho official GraphQL API", type: "OFFICIAL_API", url: MORPHO_API_URL }
        : record.source,
      sourceObservationIds: [
        ...new Set([...record.sourceObservationIds, ...live.sourceObservationIds])
      ],
      warnings: [
        ...record.warnings.filter(
          (warning) => !warning.startsWith("Yield is ") && !warning.startsWith("AUM/TVL is ")
        ),
        "Official Morpho evidence is a bounded runtime fallback when persisted worker observations are missing or stale.",
        ...(live.riskScore === null
          ? [
              "Comparative risk is unavailable because no compatible published methodology is effective."
            ]
          : [
              "Comparative risk is provisional because unavailable factors use the published conservative proxy."
            ])
      ]
    };
  });
};

const countStaleRoutes = (records: readonly CatalogRecord[]): number =>
  records.filter((record) =>
    Object.values(record.metricStatus).some((state) => state.status === "STALE")
  ).length;

const statusFromEvidence = (
  evidence: readonly LiveMorphoEvidence[],
  records: readonly CatalogRecord[],
  checkedAt: string
): OfficialProviderStatus => ({
  checkedAt,
  errorCategory: null,
  latestObservedAt:
    evidence.map((item) => item.dataTimestamp).sort((a, b) => b.localeCompare(a))[0] ?? null,
  providerCode: "MORPHO_OFFICIAL_GRAPHQL",
  routesAvailable: evidence.length,
  routesExpected: MORPHO_PRODUCTION_ROUTES.length,
  routesStale: countStaleRoutes(records),
  state:
    evidence.length === MORPHO_PRODUCTION_ROUTES.length
      ? "HEALTHY"
      : evidence.length > 0
        ? "DEGRADED"
        : "UNAVAILABLE"
});

export async function getLiveCatalog(): Promise<CatalogRecord[]> {
  const model = await getEffectivePublicReadModel();
  const checkedAt = new Date().toISOString();
  if (model.databaseState === "UNAVAILABLE") {
    lastProviderStatus = {
      checkedAt,
      errorCategory: "DATABASE_UNAVAILABLE",
      latestObservedAt: null,
      providerCode: "MORPHO_OFFICIAL_GRAPHQL",
      routesAvailable: 0,
      routesExpected: MORPHO_PRODUCTION_ROUTES.length,
      routesStale: 0,
      state: "UNAVAILABLE"
    };
    return [...model.catalog];
  }

  try {
    const evidence = await fetchLiveMorphoEvidence(model.methodology?.methodology ?? null);
    const records = overlayLiveEvidence(model, evidence);
    lastProviderStatus = statusFromEvidence(evidence, records, checkedAt);
    return records;
  } catch (error) {
    const records = stalePersistedMorphoRecords(model);
    const latestObservedAt =
      records
        .flatMap((record) => (record.observedAt === null ? [] : [record.observedAt]))
        .sort((left, right) => right.localeCompare(left))[0] ?? null;
    lastProviderStatus = {
      checkedAt,
      errorCategory: classifyProviderFailure(error),
      latestObservedAt,
      providerCode: "MORPHO_OFFICIAL_GRAPHQL",
      routesAvailable: 0,
      routesExpected: MORPHO_PRODUCTION_ROUTES.length,
      routesStale: countStaleRoutes(records),
      state: latestObservedAt === null ? "UNAVAILABLE" : "DEGRADED"
    };
    return [...records];
  }
}

export async function getOfficialProviderStatus(): Promise<OfficialProviderStatus> {
  await getLiveCatalog();
  return (
    lastProviderStatus ?? {
      checkedAt: new Date().toISOString(),
      errorCategory: "NETWORK_ERROR",
      latestObservedAt: null,
      providerCode: "MORPHO_OFFICIAL_GRAPHQL",
      routesAvailable: 0,
      routesExpected: MORPHO_PRODUCTION_ROUTES.length,
      routesStale: 0,
      state: "UNAVAILABLE"
    }
  );
}

export async function getLiveCatalogRecord(slug: string): Promise<CatalogRecord | undefined> {
  return (await getLiveCatalog()).find((record) => record.slug === slug);
}

export async function getLiveProductCatalogRecord(
  slug: string
): Promise<CatalogRecord | undefined> {
  return (await getLiveCatalog()).find((record) => record.productSlug === slug);
}

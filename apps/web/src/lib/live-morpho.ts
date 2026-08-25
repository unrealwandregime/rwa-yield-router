import "server-only";

import {
  AdapterError,
  CircuitBreaker,
  CircuitOpenError,
  createTokenBucketRateLimiter,
  MORPHO_API_URL,
  MORPHO_PRODUCTION_ROUTES,
  safeFetchJson,
  type HostResolver
} from "@rwa-yield-router/data-adapters";
import {
  calculateCompositeRisk,
  calculateRiskAdjustedApy,
  type RiskMethodology
} from "@rwa-yield-router/risk-engine";
import { getServerConfig } from "@rwa-yield-router/config";
import Decimal from "decimal.js";
import { z } from "zod";
import type { CatalogMetricState, CatalogRecord } from "@/lib/catalog";
import {
  getEffectivePublicReadModel,
  type EffectivePublicReadModel
} from "@/lib/public-read-model";

const decimalLike = z
  .union([z.string().max(128), z.number().finite()])
  .transform((value) => String(value))
  .refine((value) => /^-?\d+(?:\.\d+)?$/u.test(value), "Expected a plain decimal");

const nonnegativeDecimalLike = decimalLike.refine(
  (value) => new Decimal(value).gte(0),
  "Expected a nonnegative decimal"
);

const morphoResponseSchema = z.object({
  data: z.object({
    vaults: z.object({
      items: z
        .array(
          z.object({
            address: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
            chain: z.object({ id: z.number().int().positive() }),
            liquidity: z.object({ usd: nonnegativeDecimalLike.nullable() }).nullable(),
            state: z.object({
              apy: decimalLike.nullable(),
              fee: decimalLike.nullable(),
              netApy: decimalLike.nullable(),
              netApyExcludingRewards: decimalLike.nullable(),
              totalAssetsUsd: nonnegativeDecimalLike.nullable()
            })
          })
        )
        .max(1_000)
    })
  }),
  errors: z
    .array(z.object({ message: z.string().max(500) }))
    .max(20)
    .optional()
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
  readonly netApyClassification: "PROVIDER_REPORTED_BEFORE_USER_TRANSACTION_COSTS";
  readonly riskEvidenceCoveragePct: string | null;
  readonly riskStatus: "ESTIMATED" | "UNAVAILABLE";
  readonly riskUsesUnknownProxy: boolean;
  readonly unavailableRiskFactors: readonly string[];
  readonly unknownRiskProxy: string | null;
  readonly fetchedAt: string;
  readonly methodologyVersion: string | null;
}

export type OfficialProviderErrorCategory =
  | "DATABASE_UNAVAILABLE"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "PROVIDER_FETCH_DISABLED"
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
let providerRequestInFlight:
  | Promise<
      Readonly<{
        fetchedAt: string;
        response: z.infer<typeof morphoResponseSchema>;
      }>
    >
  | undefined;

const providerRateLimiter = createTokenBucketRateLimiter({
  capacity: 4,
  refillTokensPerSecond: 0.2
});
const providerCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  recoveryTimeoutMs: 60_000
});

export interface LiveMorphoFetchDependencies {
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly resolver?: HostResolver | undefined;
}

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
  if (error instanceof CircuitOpenError) return "NETWORK_ERROR";
  if (error instanceof AdapterError) {
    if (error.code === "TIMEOUT") return "TIMEOUT";
    if (error.code === "UPSTREAM_REJECTED") return "HTTP_ERROR";
    if (
      error.code === "MALFORMED_RESPONSE" ||
      error.code === "RESPONSE_TOO_LARGE" ||
      error.code === "UNSUPPORTED_CONTENT_TYPE" ||
      error.code === "REDIRECT_BLOCKED"
    )
      return "INVALID_RESPONSE";
    return "NETWORK_ERROR";
  }
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
  methodology: RiskMethodology | null = null,
  dependencies: LiveMorphoFetchDependencies = {}
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

  const endpoint = new URL(MORPHO_API_URL);
  providerRequestInFlight ??= providerCircuitBreaker
    .execute(async () => ({
      fetchedAt: new Date().toISOString(),
      response: await safeFetchJson({
        init: {
          body: JSON.stringify({ query: MORPHO_QUERY }),
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST"
        },
        policy: {
          allowedContentTypes: new Set(["application/json"]),
          allowedHosts: new Set([endpoint.hostname]),
          fetchImplementation: dependencies.fetchImplementation,
          maxCompressionRatio: 20,
          maxRedirects: 0,
          maxResponseBytes: 1_000_000,
          rateLimiter: providerRateLimiter,
          resolver: dependencies.resolver,
          timeoutMs: 3_000
        },
        schema: morphoResponseSchema,
        url: endpoint.toString()
      })
    }))
    .finally(() => {
      providerRequestInFlight = undefined;
    });
  const requestResult = await providerRequestInFlight.catch((error: unknown) => {
    throw cachedProviderFailure(classifyProviderFailure(error), methodologyVersion);
  });
  const parsed = requestResult.response;
  if (parsed.errors && parsed.errors.length > 0)
    throw cachedProviderFailure("PROVIDER_REJECTED", methodologyVersion);

  const byIdentity = new Map(
    parsed.data.vaults.items.map((item) => [`${item.chain.id}:${item.address.toLowerCase()}`, item])
  );
  const fetchedAt = requestResult.fetchedAt;
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
      fetchedAt,
      grossApy,
      immediateLiquidityPct: boundedLiquidityPercent(liquidity, tvl),
      incentiveApy: Decimal.max(0, new Decimal(netRatio).minus(netExcludingRewards).mul(100))
        .toDecimalPlaces(12)
        .toString(),
      methodologyVersion,
      netApy,
      netApyClassification: "PROVIDER_REPORTED_BEFORE_USER_TRANSACTION_COSTS",
      riskEvidenceCoveragePct: compositeRisk?.evidenceCoveragePct ?? null,
      riskScore: compositeRisk?.score ?? null,
      riskStatus: compositeRisk === null ? "UNAVAILABLE" : "ESTIMATED",
      riskUsesUnknownProxy: compositeRisk?.status === "PROVISIONAL",
      routeSlug: identity.routeSlug,
      unavailableRiskFactors: compositeRisk?.unavailableFactors ?? [],
      unknownRiskProxy: methodology?.unknownRiskProxy ?? null
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

const estimatedRiskMetricState = (at: string): CatalogMetricState => ({
  confidence: "ESTIMATED",
  observedAt: at,
  status: "ESTIMATED"
});

const unavailableRiskMetricState = (at: string): CatalogMetricState => ({
  confidence: "UNAVAILABLE",
  observedAt: at,
  status: "UNAVAILABLE"
});

export const annotatePersistedMorphoProviderFailure = (
  model: Pick<EffectivePublicReadModel, "catalog"> & {
    readonly persistedEvidenceBySlug: ReadonlyMap<string, unknown>;
  }
): readonly CatalogRecord[] => {
  const canonical = new Set(MORPHO_PRODUCTION_ROUTES.map((route) => route.routeSlug));
  return model.catalog.map((record) => {
    if (!canonical.has(record.slug) || !model.persistedEvidenceBySlug.has(record.slug))
      return record;
    return {
      ...record,
      warnings: [
        ...record.warnings.filter(
          (warning) => !warning.startsWith("The request-time Morpho refresh is unavailable;")
        ),
        "The request-time Morpho refresh is unavailable; displayed persisted observations retain their independently evaluated freshness status."
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
    const usesRuntimeFallback =
      !persistedYieldCurrent || record.grossApy === null || record.netApy === null;
    if (!usesRuntimeFallback) return record;
    const metricStatus = {
      aumTvl: currentMetricState(live.fetchedAt),
      liquidity: currentMetricState(live.fetchedAt),
      risk:
        live.riskScore === null
          ? unavailableRiskMetricState(live.fetchedAt)
          : estimatedRiskMetricState(live.fetchedAt),
      yield: currentMetricState(live.fetchedAt)
    } satisfies CatalogRecord["metricStatus"];
    const observedAt =
      Object.values(metricStatus)
        .flatMap((state) => (state.observedAt === null ? [] : [state.observedAt]))
        .sort((left, right) => right.localeCompare(left))[0] ?? record.observedAt;
    return {
      ...record,
      aumTvlUsd: live.aumOrTvlUsd,
      confidence: "DIRECT_API",
      grossApy: live.grossApy,
      liquidityUsd: live.availableLiquidityUsd,
      methodologyVersion: live.methodologyVersion,
      metricStatus,
      netApy: live.netApy,
      observedAt,
      riskAdjustedApy: live.comparativeRiskAdjustedApy,
      riskScore: live.riskScore,
      source: { name: "Morpho official GraphQL API", type: "OFFICIAL_API", url: MORPHO_API_URL },
      // A record-level list cannot truthfully distinguish persisted fields
      // from request-time replacements. Clear it instead of implying that old
      // UUIDs support the displayed live values.
      sourceObservationIds: [],
      warnings: [
        ...record.warnings.filter(
          (warning) =>
            !warning.startsWith("Yield is ") &&
            !warning.startsWith("AUM/TVL is ") &&
            !warning.startsWith("Request-time Morpho fallback values") &&
            !warning.startsWith("Morpho provider-reported net APY") &&
            !warning.startsWith("Comparative risk is ESTIMATED") &&
            !warning.startsWith("Comparative risk is unavailable")
        ),
        "Official Morpho evidence is a bounded runtime fallback when persisted worker observations are missing or stale.",
        "Request-time Morpho fallback values are not assigned database observation IDs and are excluded from optimizer inputs unless matching worker observations are persisted.",
        ...(live.netApyClassification === "PROVIDER_REPORTED_BEFORE_USER_TRANSACTION_COSTS"
          ? [
              "Morpho provider-reported net APY includes the provider's vault-fee and reward treatment but remains before user-specific entry, exit, gas, and slippage costs."
            ]
          : []),
        ...(live.riskStatus === "UNAVAILABLE"
          ? [
              "Comparative risk is unavailable because no compatible published methodology is effective."
            ]
          : live.riskStatus === "ESTIMATED"
            ? [
                `Comparative risk is ESTIMATED with ${live.riskEvidenceCoveragePct ?? "0"}% evidence coverage: ${live.unavailableRiskFactors.length} weighted factors are unavailable and the published ${live.unknownRiskProxy ?? "unknown"} unknown-risk proxy is used for comparative ranking.`
              ]
            : [])
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
    evidence.map((item) => item.fetchedAt).sort((a, b) => b.localeCompare(a))[0] ?? null,
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
  if (!getServerConfig().requestTimeProviderFetchEnabled) {
    lastProviderStatus = {
      checkedAt,
      errorCategory: "PROVIDER_FETCH_DISABLED",
      latestObservedAt: null,
      providerCode: "MORPHO_OFFICIAL_GRAPHQL",
      routesAvailable: 0,
      routesExpected: MORPHO_PRODUCTION_ROUTES.length,
      routesStale: countStaleRoutes(model.catalog),
      state: "UNAVAILABLE"
    };
    return [...model.catalog];
  }
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
    const records = annotatePersistedMorphoProviderFailure(model);
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

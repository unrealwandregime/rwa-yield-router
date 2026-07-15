import "server-only";

import { confidenceClassificationSchema, yieldSourceClassSchema } from "@rwa-yield-router/domain";
import type { RouteCandidate } from "@rwa-yield-router/routing-engine";
import Decimal from "decimal.js";
import { fetchLiveMorphoEvidence, getLiveCatalog } from "@/lib/live-morpho";
import { getEffectivePublicReadModel, type PersistedRouteEvidence } from "@/lib/public-read-model";

const INVESTOR_CLASSIFICATIONS = [
  "RETAIL",
  "ACCREDITED",
  "QUALIFIED",
  "PROFESSIONAL",
  "INSTITUTIONAL"
] as const;

const identifier = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "") || "unavailable";

const boundedPercent = (amount: string, total: string): string => {
  const denominator = new Decimal(total);
  if (denominator.lte(0)) return "0";
  return Decimal.min(100, new Decimal(amount).div(denominator).mul(100))
    .toDecimalPlaces(8)
    .toString();
};

const persistedLiquidityPercentages = (
  evidence: PersistedRouteEvidence
): RouteCandidate["liquidity"] | null => {
  const { immediate, within24Hours, within7Days } = evidence.liquidityAmounts;
  if (
    evidence.aumOrTvlUsd === null ||
    immediate === null ||
    within24Hours === null ||
    within7Days === null
  ) {
    return null;
  }
  return {
    immediatePct: boundedPercent(immediate, evidence.aumOrTvlUsd),
    within24HoursPct: boundedPercent(within24Hours, evidence.aumOrTvlUsd),
    within7DaysPct: boundedPercent(within7Days, evidence.aumOrTvlUsd)
  };
};

const candidateDataStatus = (
  evidence: PersistedRouteEvidence | undefined,
  usedLiveFallback: boolean
): RouteCandidate["dataStatus"] => {
  if (usedLiveFallback) return "CURRENT";
  if (evidence === undefined) return "UNAVAILABLE";
  const states = [
    evidence.yieldState.status,
    evidence.aumState.status,
    evidence.liquidityState.status,
    evidence.riskState.status
  ];
  if (states.some((status) => status === "STALE" || status === "DEGRADED")) return "STALE";
  if (states.some((status) => status === "ESTIMATED")) return "ESTIMATED";
  if (states.every((status) => status === "CURRENT")) return "CURRENT";
  return "UNAVAILABLE";
};

/**
 * Builds optimizer candidates from the same effective public publication and
 * methodology used by the screener. Incomplete or incompatible evidence is
 * omitted rather than repaired with assumptions.
 */
export async function buildSimulationCandidates(): Promise<RouteCandidate[]> {
  const model = await getEffectivePublicReadModel();
  if (model.methodology === null) return [];
  const methodologyVersion = model.methodology.methodology.semanticVersion;
  const catalog = await getLiveCatalog();
  let liveEvidence: Awaited<ReturnType<typeof fetchLiveMorphoEvidence>> = [];
  try {
    liveEvidence = await fetchLiveMorphoEvidence(model.methodology.methodology);
  } catch {
    // Persisted evidence remains eligible for evaluation below, with stale
    // state preserved by the public read facade.
  }
  const liveBySlug = new Map(liveEvidence.map((evidence) => [evidence.routeSlug, evidence]));

  return catalog.flatMap((record) => {
    if (
      record.publicationStatus !== "PUBLISHED" ||
      record.methodologyVersion !== methodologyVersion ||
      record.grossApy === null ||
      record.netApy === null ||
      record.riskAdjustedApy === null ||
      record.riskScore === null ||
      record.aumTvlUsd === null ||
      record.liquidityUsd === null ||
      record.sourceObservationIds.length === 0
    ) {
      return [];
    }
    const persisted = model.persistedEvidenceBySlug.get(record.slug);
    const live = liveBySlug.get(record.slug);
    const persistedLiquidity =
      persisted === undefined ? null : persistedLiquidityPercentages(persisted);
    const liquidity =
      persistedLiquidity ??
      (live === undefined
        ? null
        : {
            immediatePct: live.immediateLiquidityPct,
            within24HoursPct: live.immediateLiquidityPct,
            within7DaysPct: live.immediateLiquidityPct
          });
    const incentiveApy = persisted?.incentiveApy ?? live?.incentiveApy ?? null;
    if (liquidity === null || incentiveApy === null) return [];
    const yieldSourceClasses = persisted?.yieldSourceClasses ?? [record.yieldSource];
    if (yieldSourceClasses.length !== 1) return [];
    const eligibility = persisted?.eligibility ?? {
      investorClassifications: [...INVESTOR_CLASSIFICATIONS],
      jurisdictions: [],
      status: "CONDITIONAL" as const
    };
    const dataStatus = candidateDataStatus(persisted, live !== undefined);
    const parsedConfidence = confidenceClassificationSchema.safeParse(record.confidence);
    if (!parsedConfidence.success) return [];
    const lifecycle =
      persisted?.lifecycle ??
      (record.lifecycleStatus === "ACTIVE"
        ? "PUBLISHED"
        : record.lifecycleStatus === "PAUSED"
          ? "PAUSED"
          : record.lifecycleStatus === "CLOSED"
            ? "CLOSED"
            : "UNAVAILABLE");
    const parsedYieldSource = yieldSourceClassSchema.safeParse(yieldSourceClasses[0]);
    if (!parsedYieldSource.success) return [];

    return [
      {
        aumOrTvlUsd: record.aumTvlUsd,
        availableLiquidityUsd: record.liquidityUsd,
        category: record.category,
        chainId: persisted?.chainId ?? live?.chainId ?? identifier(record.chain),
        comparativeRiskAdjustedApyBeforeTransactionCosts: record.riskAdjustedApy,
        confidence: dataStatus === "STALE" ? "STALE" : parsedConfidence.data,
        dataStatus,
        dataTimestamp: record.observedAt ?? record.verifiedAt,
        eligibility: {
          investorClassifications: [...eligibility.investorClassifications],
          jurisdictions: [...eligibility.jurisdictions],
          status: eligibility.status
        },
        grossApy: record.grossApy,
        incentiveApy,
        isDefi: record.category === "DEFI_LENDING" || record.category === "STABLECOIN_VAULT",
        isGold: record.category === "GOLD_BACKED_TOKEN",
        isRwa:
          record.category === "TOKENIZED_TBILL" ||
          record.category === "MONEY_MARKET_TOKEN" ||
          record.category === "GOLD_BACKED_TOKEN" ||
          record.category === "CASH_EQUIVALENT",
        issuerId: persisted?.issuerId ?? identifier(record.issuer),
        kyc:
          persisted?.kyc ??
          (record.kycRequired === null
            ? "UNKNOWN"
            : record.kycRequired
              ? "REQUIRED"
              : "NOT_REQUIRED"),
        lifecycle,
        liquidity,
        methodologyVersion,
        netApyBeforeTransactionCosts: record.netApy,
        productId: persisted?.productId ?? `product-${record.slug}`,
        protocolId: persisted?.protocolId ?? (record.protocol ? identifier(record.protocol) : null),
        riskScore: record.riskScore,
        routeId: persisted?.routeId ?? record.slug,
        sourceObservationIds: [...record.sourceObservationIds],
        stablecoinId:
          persisted?.stablecoinId ??
          (record.underlyingAsset.toUpperCase().includes("USD")
            ? identifier(record.underlyingAsset)
            : null),
        transactionCosts: {
          defaultFixedCostUsd: "0",
          defaultSlippageBps: "0",
          overrides: []
        },
        underlyingAssetId: persisted?.underlyingAssetId ?? identifier(record.underlyingAsset),
        verified: true,
        yieldSourceBreakdown: [{ sharePct: "100", sourceClass: parsedYieldSource.data }]
      } satisfies RouteCandidate
    ];
  });
}

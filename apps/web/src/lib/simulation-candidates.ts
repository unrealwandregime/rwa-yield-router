import "server-only";

import { confidenceClassificationSchema, yieldSourceClassSchema } from "@rwa-yield-router/domain";
import type { RouteCandidate } from "@rwa-yield-router/routing-engine";
import Decimal from "decimal.js";
import { getEffectivePublicReadModel, type PersistedRouteEvidence } from "@/lib/public-read-model";

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
  if (evidence.aumOrTvlUsd === null || immediate === null) return null;
  // An amount evidenced as immediately withdrawable is also a conservative
  // lower bound for the longer windows. Never infer additional liquidity.
  const within24HoursFloor = within24Hours ?? immediate;
  const within7DaysFloor = within7Days ?? within24HoursFloor;
  return {
    immediatePct: boundedPercent(immediate, evidence.aumOrTvlUsd),
    within24HoursPct: boundedPercent(within24HoursFloor, evidence.aumOrTvlUsd),
    within7DaysPct: boundedPercent(within7DaysFloor, evidence.aumOrTvlUsd)
  };
};

const candidateDataStatus = (evidence: PersistedRouteEvidence): RouteCandidate["dataStatus"] => {
  const states = [
    evidence.yieldState.status,
    evidence.aumState.status,
    evidence.liquidityState.status,
    evidence.riskState.status
  ];
  if (
    states.some(
      (status) =>
        status === "UNKNOWN" ||
        status === "UNAVAILABLE" ||
        status === "AWAITING_VERIFICATION" ||
        status === "CONFLICTED" ||
        status === "REJECTED"
    )
  )
    return "UNAVAILABLE";
  if (states.some((status) => status === "STALE" || status === "DEGRADED")) return "STALE";
  if (states.some((status) => status === "ESTIMATED")) return "ESTIMATED";
  if (states.every((status) => status === "CURRENT")) return "CURRENT";
  return "UNAVAILABLE";
};

const persistedDataTimestamp = (evidence: PersistedRouteEvidence): string | null =>
  [
    evidence.yieldState.observedAt,
    evidence.aumState.observedAt,
    evidence.liquidityState.observedAt,
    evidence.riskState.observedAt
  ]
    .filter((timestamp): timestamp is string => timestamp !== null)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

/**
 * Builds optimizer candidates from the same effective public publication and
 * methodology used by the screener. Incomplete or incompatible evidence is
 * omitted rather than repaired with assumptions.
 */
export async function buildSimulationCandidates(): Promise<RouteCandidate[]> {
  const model = await getEffectivePublicReadModel();
  if (model.methodology === null) return [];
  const methodologyVersion = model.methodology.methodology.semanticVersion;
  return model.catalog.flatMap((record) => {
    const persisted = model.persistedEvidenceBySlug.get(record.slug);
    if (
      record.publicationStatus !== "PUBLISHED" ||
      persisted === undefined ||
      persisted.methodologyVersion !== methodologyVersion ||
      persisted.grossApy === null ||
      persisted.netApy === null ||
      persisted.comparativeRiskAdjustedApy === null ||
      persisted.riskScore === null ||
      persisted.aumOrTvlUsd === null ||
      persisted.availableLiquidityUsd === null ||
      persisted.incentiveApy === null
    ) {
      return [];
    }
    const sourceObservationIds = [...new Set(persisted.sourceObservationIds)];
    const catalogObservationIds = [...new Set(record.sourceObservationIds)];
    const metricObservationIds = persisted.metricObservationIds;
    const metricObservationUnion = [
      ...new Set([
        ...metricObservationIds.yield,
        ...metricObservationIds.aumTvl,
        ...metricObservationIds.liquidity,
        ...metricObservationIds.risk
      ])
    ];
    // Each material optimizer input family must have explicit persisted
    // provenance. A total-count check is insufficient because several values
    // can otherwise point to the same family while risk evidence is absent.
    if (
      metricObservationIds.yield.length === 0 ||
      metricObservationIds.aumTvl.length === 0 ||
      metricObservationIds.liquidity.length === 0 ||
      metricObservationIds.risk.length === 0 ||
      metricObservationUnion.length !== sourceObservationIds.length ||
      metricObservationUnion.some(
        (observationId) => !sourceObservationIds.includes(observationId)
      ) ||
      catalogObservationIds.length !== sourceObservationIds.length ||
      sourceObservationIds.some((observationId) => !catalogObservationIds.includes(observationId))
    )
      return [];
    const liquidity = persistedLiquidityPercentages(persisted);
    const dataTimestamp = persistedDataTimestamp(persisted);
    if (liquidity === null || dataTimestamp === null) return [];
    const yieldSourceClasses = persisted.yieldSourceClasses;
    if (yieldSourceClasses.length !== 1) return [];
    const eligibility = persisted.eligibility;
    const dataStatus = candidateDataStatus(persisted);
    const parsedConfidence = confidenceClassificationSchema.safeParse(record.confidence);
    if (!parsedConfidence.success) return [];
    const parsedYieldSource = yieldSourceClassSchema.safeParse(yieldSourceClasses[0]);
    if (!parsedYieldSource.success) return [];

    return [
      {
        aumOrTvlUsd: persisted.aumOrTvlUsd,
        availableLiquidityUsd: persisted.availableLiquidityUsd,
        category: persisted.category,
        chainId: persisted.chainId,
        comparativeRiskAdjustedApyBeforeTransactionCosts: persisted.comparativeRiskAdjustedApy,
        confidence:
          dataStatus === "STALE"
            ? "STALE"
            : dataStatus === "ESTIMATED"
              ? "ESTIMATED"
              : dataStatus === "UNAVAILABLE"
                ? "UNAVAILABLE"
                : parsedConfidence.data,
        dataStatus,
        dataTimestamp,
        eligibility: {
          investorClassifications: [...eligibility.investorClassifications],
          jurisdictions: [...eligibility.jurisdictions],
          status: eligibility.status
        },
        grossApy: persisted.grossApy,
        incentiveApy: persisted.incentiveApy,
        isDefi: persisted.category === "DEFI_LENDING" || persisted.category === "STABLECOIN_VAULT",
        isGold: persisted.category === "GOLD_BACKED_TOKEN",
        isRwa:
          persisted.category === "TOKENIZED_TBILL" ||
          persisted.category === "MONEY_MARKET_TOKEN" ||
          persisted.category === "GOLD_BACKED_TOKEN" ||
          persisted.category === "CASH_EQUIVALENT",
        issuerId: persisted.issuerId,
        kyc: persisted.kyc,
        lifecycle: persisted.lifecycle,
        liquidity,
        methodologyVersion,
        netApyBeforeTransactionCosts: persisted.netApy,
        productId: persisted.productId,
        protocolId: persisted.protocolId,
        riskScore: persisted.riskScore,
        routeId: persisted.routeSlug,
        sourceObservationIds,
        stablecoinId: persisted.stablecoinId,
        transactionCosts: {
          defaultFixedCostUsd: "0",
          defaultSlippageBps: "0",
          overrides: [],
          status: "UNAVAILABLE"
        },
        underlyingAssetId: persisted.underlyingAssetId,
        verified: true,
        yieldSourceBreakdown: [{ sharePct: "100", sourceClass: parsedYieldSource.data }]
      } satisfies RouteCandidate
    ];
  });
}

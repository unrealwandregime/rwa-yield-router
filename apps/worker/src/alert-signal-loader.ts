import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  compositeRiskSnapshots,
  dataQualityEvents,
  eligibilityRules,
  liquiditySnapshots,
  navSnapshots,
  productRoutes,
  products,
  redemptionTerms,
  sourceObservations,
  tvlAumSnapshots,
  utilizationSnapshots,
  yieldSnapshots,
  type Database
} from "@rwa-yield-router/database";
import Decimal from "decimal.js";
import { z } from "zod";

import type { AlertCondition, AlertSignal } from "./alert-evaluator.js";

const configurationSchema = z
  .object({ lookbackHours: z.number().int().min(1).max(8_760).default(24) })
  .passthrough();

const confidenceRanks = {
  VERIFIED_OFFICIAL: 0,
  DIRECT_API: 1,
  ONCHAIN_DERIVED: 2,
  ISSUER_REPORTED: 3,
  THIRD_PARTY: 4,
  MANUALLY_VERIFIED: 5,
  ESTIMATED: 6,
  STALE: 7,
  UNAVAILABLE: 8
} as const;

export interface AlertRuleSignalTarget {
  readonly condition: AlertCondition;
  readonly configuration: unknown;
  readonly createdAt: Date;
  readonly productId: string | null;
  readonly routeId: string | null;
}

const unavailable = (reason: string): AlertSignal => ({ availability: "UNAVAILABLE", reason });

const numericSignal = (
  input: Readonly<{
    current: string;
    previous?: string | null | undefined;
    observedAt: Date;
    observationKey: string;
    sourceObservationIds: readonly string[];
  }>
): AlertSignal => ({
  availability: "AVAILABLE",
  current: input.current,
  kind: "NUMERIC",
  observationKey: input.observationKey,
  observedAt: input.observedAt,
  previous: input.previous ?? null,
  sourceObservationIds: input.sourceObservationIds
});

const eventSignal = (
  input: Readonly<{
    active: boolean;
    observedAt: Date;
    observationKey: string;
    sourceObservationIds: readonly string[];
  }>
): AlertSignal => ({ availability: "AVAILABLE", kind: "EVENT", ...input });

const isCurrent = (status: string): boolean => status === "AVAILABLE";

export async function loadAlertSignal(
  database: Database,
  rule: AlertRuleSignalTarget,
  evaluatedAt: Date
): Promise<AlertSignal> {
  if (rule.routeId === null && rule.productId === null) return unavailable("TARGET_UNAVAILABLE");
  const configuration = configurationSchema.safeParse(rule.configuration);
  const lookbackHours = configuration.success ? configuration.data.lookbackHours : 24;
  const baselineAt = new Date(evaluatedAt.getTime() - lookbackHours * 60 * 60_000);

  const yieldTarget =
    rule.routeId !== null
      ? eq(yieldSnapshots.routeId, rule.routeId)
      : eq(yieldSnapshots.productId, rule.productId ?? "00000000-0000-0000-0000-000000000000");
  const tvlTarget =
    rule.routeId !== null
      ? eq(tvlAumSnapshots.routeId, rule.routeId)
      : eq(tvlAumSnapshots.productId, rule.productId ?? "00000000-0000-0000-0000-000000000000");
  const liquidityTarget =
    rule.routeId !== null
      ? eq(liquiditySnapshots.routeId, rule.routeId)
      : eq(liquiditySnapshots.productId, rule.productId ?? "00000000-0000-0000-0000-000000000000");
  const utilizationTarget =
    rule.routeId !== null
      ? eq(utilizationSnapshots.routeId, rule.routeId)
      : eq(
          utilizationSnapshots.productId,
          rule.productId ?? "00000000-0000-0000-0000-000000000000"
        );
  const navTarget =
    rule.routeId !== null
      ? eq(navSnapshots.routeId, rule.routeId)
      : eq(navSnapshots.productId, rule.productId ?? "00000000-0000-0000-0000-000000000000");
  const riskTarget =
    rule.routeId !== null
      ? eq(compositeRiskSnapshots.routeId, rule.routeId)
      : eq(
          compositeRiskSnapshots.productId,
          rule.productId ?? "00000000-0000-0000-0000-000000000000"
        );

  if (
    rule.condition === "APY_ABOVE" ||
    rule.condition === "APY_BELOW" ||
    rule.condition === "APY_CHANGE" ||
    rule.condition === "CONFIDENCE_DOWNGRADE" ||
    rule.condition === "INCENTIVE_END"
  ) {
    const [latest] = await database
      .select({
        asOf: yieldSnapshots.asOf,
        confidence: yieldSnapshots.confidence,
        id: yieldSnapshots.id,
        isPromotional: yieldSnapshots.isPromotional,
        netApy: yieldSnapshots.netApy,
        promotionEndsAt: yieldSnapshots.promotionEndsAt,
        sourceObservationId: yieldSnapshots.sourceObservationId,
        status: yieldSnapshots.status
      })
      .from(yieldSnapshots)
      .where(yieldTarget)
      .orderBy(desc(yieldSnapshots.asOf))
      .limit(1);
    if (latest === undefined || !isCurrent(latest.status))
      return unavailable("CURRENT_APY_UNAVAILABLE");

    if (rule.condition === "INCENTIVE_END") {
      const daysUntilEnd =
        latest.isPromotional && latest.promotionEndsAt !== null
          ? new Decimal(latest.promotionEndsAt.getTime())
              .minus(evaluatedAt.getTime())
              .div(86_400_000)
              .toFixed()
          : "-1";
      return numericSignal({
        current: daysUntilEnd,
        observedAt: latest.asOf,
        observationKey: latest.id,
        sourceObservationIds: [latest.sourceObservationId]
      });
    }
    if (latest.netApy === null) return unavailable("CURRENT_NET_APY_UNAVAILABLE");
    if (rule.condition === "APY_ABOVE" || rule.condition === "APY_BELOW") {
      return numericSignal({
        current: latest.netApy,
        observedAt: latest.asOf,
        observationKey: latest.id,
        sourceObservationIds: [latest.sourceObservationId]
      });
    }
    const [baseline] = await database
      .select({
        confidence: yieldSnapshots.confidence,
        id: yieldSnapshots.id,
        netApy: yieldSnapshots.netApy,
        sourceObservationId: yieldSnapshots.sourceObservationId
      })
      .from(yieldSnapshots)
      .where(and(yieldTarget, lte(yieldSnapshots.asOf, baselineAt)))
      .orderBy(desc(yieldSnapshots.asOf))
      .limit(1);
    if (baseline === undefined) return unavailable("APY_BASELINE_UNAVAILABLE");
    return rule.condition === "APY_CHANGE"
      ? baseline.netApy === null
        ? unavailable("APY_BASELINE_UNAVAILABLE")
        : numericSignal({
            current: latest.netApy,
            observedAt: latest.asOf,
            observationKey: `${latest.id}:${baseline.id}`,
            previous: baseline.netApy,
            sourceObservationIds: [latest.sourceObservationId, baseline.sourceObservationId]
          })
      : numericSignal({
          current: String(confidenceRanks[latest.confidence]),
          observedAt: latest.asOf,
          observationKey: `${latest.id}:${baseline.id}`,
          previous: String(confidenceRanks[baseline.confidence]),
          sourceObservationIds: [latest.sourceObservationId, baseline.sourceObservationId]
        });
  }

  if (rule.condition === "TVL_AUM_DECLINE") {
    const [latest] = await database
      .select({
        amount: tvlAumSnapshots.amount,
        asOf: tvlAumSnapshots.asOf,
        id: tvlAumSnapshots.id,
        metricKind: tvlAumSnapshots.metricKind,
        sourceObservationId: tvlAumSnapshots.sourceObservationId,
        status: tvlAumSnapshots.status
      })
      .from(tvlAumSnapshots)
      .where(tvlTarget)
      .orderBy(desc(tvlAumSnapshots.asOf))
      .limit(1);
    if (latest === undefined || !isCurrent(latest.status) || latest.amount === null) {
      return unavailable("CURRENT_TVL_AUM_UNAVAILABLE");
    }
    const [baseline] = await database
      .select({
        amount: tvlAumSnapshots.amount,
        id: tvlAumSnapshots.id,
        sourceObservationId: tvlAumSnapshots.sourceObservationId
      })
      .from(tvlAumSnapshots)
      .where(
        and(
          tvlTarget,
          eq(tvlAumSnapshots.metricKind, latest.metricKind),
          lte(tvlAumSnapshots.asOf, baselineAt)
        )
      )
      .orderBy(desc(tvlAumSnapshots.asOf))
      .limit(1);
    if (baseline?.amount == null) return unavailable("TVL_AUM_BASELINE_UNAVAILABLE");
    return numericSignal({
      current: latest.amount,
      observedAt: latest.asOf,
      observationKey: `${latest.id}:${baseline.id}`,
      previous: baseline.amount,
      sourceObservationIds: [latest.sourceObservationId, baseline.sourceObservationId]
    });
  }

  if (rule.condition === "LIQUIDITY_DETERIORATION") {
    const [latest] = await database
      .select({
        amount: liquiditySnapshots.immediatelyAvailable,
        asOf: liquiditySnapshots.asOf,
        id: liquiditySnapshots.id,
        sourceObservationId: liquiditySnapshots.sourceObservationId,
        status: liquiditySnapshots.status
      })
      .from(liquiditySnapshots)
      .where(liquidityTarget)
      .orderBy(desc(liquiditySnapshots.asOf))
      .limit(1);
    if (latest === undefined || !isCurrent(latest.status) || latest.amount === null) {
      return unavailable("CURRENT_LIQUIDITY_UNAVAILABLE");
    }
    const [baseline] = await database
      .select({
        amount: liquiditySnapshots.immediatelyAvailable,
        id: liquiditySnapshots.id,
        sourceObservationId: liquiditySnapshots.sourceObservationId
      })
      .from(liquiditySnapshots)
      .where(and(liquidityTarget, lte(liquiditySnapshots.asOf, baselineAt)))
      .orderBy(desc(liquiditySnapshots.asOf))
      .limit(1);
    if (baseline?.amount == null) return unavailable("LIQUIDITY_BASELINE_UNAVAILABLE");
    return numericSignal({
      current: latest.amount,
      observedAt: latest.asOf,
      observationKey: `${latest.id}:${baseline.id}`,
      previous: baseline.amount,
      sourceObservationIds: [latest.sourceObservationId, baseline.sourceObservationId]
    });
  }

  if (rule.condition === "UTILIZATION_SPIKE") {
    const [latest] = await database
      .select({
        asOf: utilizationSnapshots.asOf,
        id: utilizationSnapshots.id,
        ratio: utilizationSnapshots.utilizationRatio,
        sourceObservationId: utilizationSnapshots.sourceObservationId,
        status: utilizationSnapshots.status
      })
      .from(utilizationSnapshots)
      .where(utilizationTarget)
      .orderBy(desc(utilizationSnapshots.asOf))
      .limit(1);
    if (latest === undefined || !isCurrent(latest.status) || latest.ratio === null) {
      return unavailable("CURRENT_UTILIZATION_UNAVAILABLE");
    }
    return numericSignal({
      current: new Decimal(latest.ratio).mul(100).toFixed(),
      observedAt: latest.asOf,
      observationKey: latest.id,
      sourceObservationIds: [latest.sourceObservationId]
    });
  }

  if (rule.condition === "NAV_DEVIATION") {
    const [latest] = await database
      .select({
        asOf: navSnapshots.asOf,
        deviation: navSnapshots.premiumDiscountRatio,
        id: navSnapshots.id,
        sourceObservationId: navSnapshots.sourceObservationId,
        status: navSnapshots.status
      })
      .from(navSnapshots)
      .where(navTarget)
      .orderBy(desc(navSnapshots.asOf))
      .limit(1);
    if (latest === undefined || !isCurrent(latest.status) || latest.deviation === null) {
      return unavailable("CURRENT_NAV_DEVIATION_UNAVAILABLE");
    }
    return numericSignal({
      current: new Decimal(latest.deviation).mul(100).toFixed(),
      observedAt: latest.asOf,
      observationKey: latest.id,
      sourceObservationIds: [latest.sourceObservationId]
    });
  }

  if (rule.condition === "RISK_SCORE_INCREASE") {
    const [latest] = await database
      .select({
        calculatedAt: compositeRiskSnapshots.calculatedAt,
        id: compositeRiskSnapshots.id,
        score: compositeRiskSnapshots.compositeScore
      })
      .from(compositeRiskSnapshots)
      .where(riskTarget)
      .orderBy(desc(compositeRiskSnapshots.calculatedAt))
      .limit(1);
    if (latest?.score == null) return unavailable("CURRENT_RISK_SCORE_UNAVAILABLE");
    const [baseline] = await database
      .select({ id: compositeRiskSnapshots.id, score: compositeRiskSnapshots.compositeScore })
      .from(compositeRiskSnapshots)
      .where(and(riskTarget, lte(compositeRiskSnapshots.calculatedAt, baselineAt)))
      .orderBy(desc(compositeRiskSnapshots.calculatedAt))
      .limit(1);
    if (baseline?.score == null) return unavailable("RISK_SCORE_BASELINE_UNAVAILABLE");
    return numericSignal({
      current: latest.score,
      observedAt: latest.calculatedAt,
      observationKey: `${latest.id}:${baseline.id}`,
      previous: baseline.score,
      sourceObservationIds: []
    });
  }

  if (rule.condition === "STALE_DATA") {
    const entityType = rule.routeId === null ? "PRODUCT" : "PRODUCT_ROUTE";
    const entityId = rule.routeId ?? rule.productId;
    if (entityId === null) return unavailable("TARGET_UNAVAILABLE");
    const [latest] = await database
      .select({
        id: sourceObservations.id,
        observedAt: sourceObservations.observedAt,
        status: sourceObservations.status
      })
      .from(sourceObservations)
      .where(
        and(
          eq(sourceObservations.entityType, entityType),
          eq(sourceObservations.entityId, entityId)
        )
      )
      .orderBy(desc(sourceObservations.observedAt))
      .limit(1);
    if (latest === undefined) return unavailable("SOURCE_OBSERVATION_UNAVAILABLE");
    const ageHours = Decimal.max(
      0,
      new Decimal(evaluatedAt.getTime()).minus(latest.observedAt.getTime()).div(3_600_000)
    ).toFixed();
    return numericSignal({
      current: ageHours,
      observedAt: latest.observedAt,
      observationKey: `${latest.id}:${latest.status}`,
      sourceObservationIds: [latest.id]
    });
  }

  if (rule.condition === "REDEMPTION_CHANGE" || rule.condition === "ELIGIBILITY_CHANGE") {
    const target =
      rule.routeId !== null ? { routeId: rule.routeId } : { productId: rule.productId };
    const rows =
      rule.condition === "REDEMPTION_CHANGE"
        ? await database
            .select({
              effectiveFrom: redemptionTerms.effectiveFrom,
              id: redemptionTerms.id,
              sourceObservationId: redemptionTerms.sourceObservationId,
              version: redemptionTerms.version
            })
            .from(redemptionTerms)
            .where(
              and(
                target.routeId !== undefined
                  ? eq(redemptionTerms.routeId, target.routeId)
                  : eq(
                      redemptionTerms.productId,
                      target.productId ?? "00000000-0000-0000-0000-000000000000"
                    ),
                eq(redemptionTerms.publicationStatus, "PUBLISHED"),
                isNull(redemptionTerms.archivedAt)
              )
            )
            .orderBy(desc(redemptionTerms.effectiveFrom))
            .limit(1)
        : await database
            .select({
              effectiveFrom: eligibilityRules.effectiveFrom,
              id: eligibilityRules.id,
              sourceObservationId: eligibilityRules.sourceObservationId,
              version: eligibilityRules.version
            })
            .from(eligibilityRules)
            .where(
              and(
                target.routeId !== undefined
                  ? eq(eligibilityRules.routeId, target.routeId)
                  : eq(
                      eligibilityRules.productId,
                      target.productId ?? "00000000-0000-0000-0000-000000000000"
                    ),
                eq(eligibilityRules.publicationStatus, "PUBLISHED"),
                isNull(eligibilityRules.archivedAt)
              )
            )
            .orderBy(desc(eligibilityRules.effectiveFrom))
            .limit(1);
    const latest = rows[0];
    if (latest === undefined) return unavailable("VERSIONED_TERMS_UNAVAILABLE");
    return eventSignal({
      active: latest.version > 1 && latest.effectiveFrom.getTime() >= rule.createdAt.getTime(),
      observedAt: latest.effectiveFrom,
      observationKey: latest.id,
      sourceObservationIds: [latest.sourceObservationId]
    });
  }

  if (rule.condition === "ISSUER_PROTOCOL_WARNING") {
    if (rule.routeId === null) return unavailable("ROUTE_REQUIRED_FOR_WARNING");
    const [target] = await database
      .select({
        issuerId: products.issuerId,
        productId: products.id,
        protocolId: productRoutes.protocolId
      })
      .from(productRoutes)
      .innerJoin(products, eq(productRoutes.productId, products.id))
      .where(eq(productRoutes.id, rule.routeId))
      .limit(1);
    if (target === undefined) return unavailable("ROUTE_UNAVAILABLE");
    const entityPredicates = [
      target.issuerId === null
        ? undefined
        : and(
            eq(dataQualityEvents.entityType, "ISSUER"),
            eq(dataQualityEvents.entityId, target.issuerId)
          ),
      target.protocolId === null
        ? undefined
        : and(
            eq(dataQualityEvents.entityType, "PROTOCOL"),
            eq(dataQualityEvents.entityId, target.protocolId)
          ),
      and(
        eq(dataQualityEvents.entityType, "PRODUCT"),
        eq(dataQualityEvents.entityId, target.productId)
      ),
      and(
        eq(dataQualityEvents.entityType, "PRODUCT_ROUTE"),
        eq(dataQualityEvents.entityId, rule.routeId)
      )
    ].filter((predicate) => predicate !== undefined);
    const [warning] = await database
      .select({ detectedAt: dataQualityEvents.detectedAt, id: dataQualityEvents.id })
      .from(dataQualityEvents)
      .where(
        and(
          or(...entityPredicates),
          inArray(dataQualityEvents.severity, ["WARNING", "HIGH", "CRITICAL"]),
          isNull(dataQualityEvents.resolvedAt)
        )
      )
      .orderBy(desc(dataQualityEvents.detectedAt))
      .limit(1);
    if (warning === undefined) {
      return eventSignal({
        active: false,
        observedAt: evaluatedAt,
        observationKey: "no-open-warning",
        sourceObservationIds: []
      });
    }
    return eventSignal({
      active: warning.detectedAt.getTime() >= rule.createdAt.getTime(),
      observedAt: warning.detectedAt,
      observationKey: warning.id,
      sourceObservationIds: []
    });
  }

  if (rule.condition === "STABLECOIN_DEPEG") {
    const entityType = rule.routeId === null ? "PRODUCT" : "PRODUCT_ROUTE";
    const entityId = rule.routeId ?? rule.productId;
    if (entityId === null) return unavailable("TARGET_UNAVAILABLE");
    const [price] = await database
      .select({
        id: sourceObservations.id,
        observedAt: sourceObservations.observedAt,
        status: sourceObservations.status,
        unit: sourceObservations.unit,
        value: sourceObservations.normalizedNumericValue
      })
      .from(sourceObservations)
      .where(
        and(
          eq(sourceObservations.entityType, entityType),
          eq(sourceObservations.entityId, entityId),
          eq(sourceObservations.metric, "STABLECOIN_PRICE_USD")
        )
      )
      .orderBy(desc(sourceObservations.observedAt))
      .limit(1);
    if (price?.value == null || !isCurrent(price.status) || price.unit !== "USD_PER_TOKEN") {
      return unavailable("VERIFIED_STABLECOIN_PRICE_UNAVAILABLE");
    }
    return numericSignal({
      current: new Decimal(price.value).minus(1).abs().mul(100).toFixed(),
      observedAt: price.observedAt,
      observationKey: price.id,
      sourceObservationIds: [price.id]
    });
  }

  if (rule.condition === "VAULT_ALLOCATION_CHANGE") {
    const entityType = rule.routeId === null ? "PRODUCT" : "PRODUCT_ROUTE";
    const entityId = rule.routeId ?? rule.productId;
    if (entityId === null) return unavailable("TARGET_UNAVAILABLE");
    const rows = await database
      .select({
        id: sourceObservations.id,
        observedAt: sourceObservations.observedAt,
        value: sourceObservations.normalizedJsonValue
      })
      .from(sourceObservations)
      .where(
        and(
          eq(sourceObservations.entityType, entityType),
          eq(sourceObservations.entityId, entityId),
          eq(sourceObservations.metric, "VAULT_ALLOCATION"),
          eq(sourceObservations.status, "AVAILABLE")
        )
      )
      .orderBy(desc(sourceObservations.observedAt))
      .limit(2);
    const latest = rows[0];
    const previous = rows[1];
    if (latest === undefined || previous === undefined) {
      return unavailable("VAULT_ALLOCATION_HISTORY_UNAVAILABLE");
    }
    return eventSignal({
      active:
        latest.observedAt.getTime() >= rule.createdAt.getTime() &&
        JSON.stringify(latest.value) !== JSON.stringify(previous.value),
      observedAt: latest.observedAt,
      observationKey: `${latest.id}:${previous.id}`,
      sourceObservationIds: [latest.id, previous.id]
    });
  }

  if (rule.condition === "PRODUCT_STATUS_CHANGE") {
    if (rule.routeId === null) return unavailable("ROUTE_REQUIRED_FOR_STATUS");
    const [target] = await database
      .select({
        productStatus: products.lifecycleStatus,
        productUpdatedAt: products.updatedAt,
        routeStatus: productRoutes.lifecycleStatus,
        routeUpdatedAt: productRoutes.updatedAt
      })
      .from(productRoutes)
      .innerJoin(products, eq(productRoutes.productId, products.id))
      .where(eq(productRoutes.id, rule.routeId))
      .limit(1);
    if (target === undefined) return unavailable("ROUTE_UNAVAILABLE");
    const observedAt =
      target.productUpdatedAt.getTime() > target.routeUpdatedAt.getTime()
        ? target.productUpdatedAt
        : target.routeUpdatedAt;
    const alertStatuses = ["PAUSED", "CLOSED", "UNAVAILABLE", "ARCHIVED"];
    return eventSignal({
      active:
        observedAt.getTime() >= rule.createdAt.getTime() &&
        (alertStatuses.includes(target.productStatus) ||
          alertStatuses.includes(target.routeStatus)),
      observedAt,
      observationKey: `${target.productStatus}:${target.routeStatus}:${observedAt.toISOString()}`,
      sourceObservationIds: []
    });
  }

  return unavailable("ALERT_SIGNAL_NOT_IMPLEMENTED");
}

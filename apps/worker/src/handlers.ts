import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";

import {
  createIdempotencyKey,
  MORPHO_PRODUCTION_ROUTES,
  type AdapterResult,
  type DataStatus,
  type MorphoGraphqlAdapter,
  type NormalizedObservation
} from "@rwa-yield-router/data-adapters";
import {
  alertEvents,
  alertRuleDestinations,
  alertRules,
  appendSourceObservation,
  assets,
  compositeRiskSnapshots,
  liquiditySnapshots,
  notificationDeliveries,
  notificationDestinations,
  productCategories,
  productRoutes,
  products,
  riskMethodologyVersions,
  sourceRegistry,
  tvlAumSnapshots,
  yieldSnapshots,
  type Database
} from "@rwa-yield-router/database";
import { calculateCompositeRisk } from "@rwa-yield-router/risk-engine";
import type { NotificationDispatcher } from "@rwa-yield-router/notifications";
import Decimal from "decimal.js";

import { evaluateAlertSignal, isAlertCooldownActive } from "./alert-evaluator.js";
import { loadAlertSignal } from "./alert-signal-loader.js";
import { WorkerJobError, type WorkerJobHandlers, type WorkerJobResult } from "./jobs.js";
import {
  deliverDueNotifications,
  deliverNotificationById
} from "./notification-delivery-service.js";

const SELECTION_POLICY_VERSION = "official-source-identity-v1";
const ALERT_EVALUATION_VERSION = "sourced-condition-evaluator-v2";

const emptyResult = (): WorkerJobResult => ({
  outcome: "SUCCEEDED",
  recordsAccepted: 0,
  recordsChanged: 0,
  recordsRead: 0,
  recordsRejected: 0,
  staleRecords: 0
});

const databaseStatus = (status: DataStatus) => {
  const statusMap = {
    CONFLICTED: "CONFLICTED",
    CURRENT: "AVAILABLE",
    ESTIMATED: "ESTIMATED",
    REJECTED: "REJECTED",
    STALE: "STALE",
    UNAVAILABLE: "UNAVAILABLE"
  } as const;
  return statusMap[status];
};

export const ratioToPercentagePoints = (ratio: string): string =>
  new Decimal(ratio).mul(100).toFixed();

const provenanceHash = (observation: NormalizedObservation): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        adapterVersion: observation.adapterVersion,
        externalEntityId: observation.externalEntityId,
        metric: observation.metric,
        normalizedValue: observation.normalizedValue,
        observedAt: observation.observedAt,
        sourceRecordId: observation.sourceRecordId,
        unit: observation.unit
      })
    )
    .digest("hex");

const observationIdempotencyKey = (observation: NormalizedObservation): string =>
  createIdempotencyKey("observation", {
    externalEntityId: observation.externalEntityId,
    metric: observation.metric,
    normalizedValue: observation.normalizedValue,
    observedAt: observation.observedAt,
    sourceId: observation.source.id
  });

export interface ProductionWorkerHandlerOptions {
  readonly database: Database;
  readonly encryptionKey?: string | undefined;
  readonly morphoAdapter: MorphoGraphqlAdapter;
  readonly notificationDispatcher: NotificationDispatcher;
  readonly now?: () => Date;
}

export const createProductionWorkerHandlers = (
  options: ProductionWorkerHandlerOptions
): WorkerJobHandlers => {
  const now = options.now ?? (() => new Date());

  return {
    async DELIVER_NOTIFICATION(job) {
      const outcome = await deliverNotificationById(
        {
          database: options.database,
          dispatcher: options.notificationDispatcher,
          encryptionKey: options.encryptionKey,
          now
        },
        job.deliveryId
      );
      return {
        ...emptyResult(),
        recordsAccepted: outcome === "SKIPPED" ? 0 : 1,
        recordsChanged: outcome === "DELIVERED" ? 1 : 0,
        recordsRead: 1,
        recordsRejected: outcome === "FAILED" || outcome === "SUPPRESSED" ? 1 : 0
      };
    },

    async EVALUATE_ALERTS(job) {
      const result = emptyResult();
      const evaluatedAt = now();
      const rules = await options.database
        .select({
          condition: alertRules.condition,
          configuration: alertRules.configuration,
          cooldownSeconds: alertRules.cooldownSeconds,
          createdAt: alertRules.createdAt,
          id: alertRules.id,
          lastTriggeredAt: alertRules.lastTriggeredAt,
          productId: alertRules.productId,
          routeId: alertRules.routeId,
          threshold: alertRules.threshold,
          thresholdUnit: alertRules.thresholdUnit
        })
        .from(alertRules)
        .where(
          and(
            eq(alertRules.enabled, true),
            isNull(alertRules.archivedAt),
            isNull(alertRules.unsubscribedAt)
          )
        );
      let accepted = 0;
      let changed = 0;
      let rejected = 0;
      let stale = 0;

      for (const rule of rules) {
        const storedConfiguration =
          typeof rule.configuration === "object" &&
          rule.configuration !== null &&
          !Array.isArray(rule.configuration)
            ? rule.configuration
            : {};
        const recordEvaluation = async (
          status: "CURRENT" | "COOLDOWN" | "TRIGGERED" | "UNAVAILABLE",
          reason: string | null
        ): Promise<void> => {
          await options.database
            .update(alertRules)
            .set({
              configuration: {
                ...storedConfiguration,
                lastEvaluation: {
                  evaluatedAt: evaluatedAt.toISOString(),
                  reason,
                  status
                }
              },
              lastEvaluatedAt: evaluatedAt,
              updatedAt: evaluatedAt
            })
            .where(eq(alertRules.id, rule.id));
        };
        if (rule.routeId === null && rule.productId === null) {
          await recordEvaluation("UNAVAILABLE", "TARGET_UNAVAILABLE");
          rejected += 1;
          continue;
        }
        const signal = await loadAlertSignal(options.database, rule, evaluatedAt);
        const evaluation = evaluateAlertSignal({
          condition: rule.condition,
          signal,
          threshold: rule.threshold
        });
        if (evaluation.outcome === "UNAVAILABLE") {
          await recordEvaluation("UNAVAILABLE", evaluation.reason);
          stale += 1;
          continue;
        }
        accepted += 1;
        const cooldownActive = isAlertCooldownActive(
          rule.lastTriggeredAt,
          evaluatedAt,
          rule.cooldownSeconds
        );
        if (evaluation.outcome !== "TRIGGERED") {
          await recordEvaluation("CURRENT", null);
          continue;
        }
        if (cooldownActive) {
          await recordEvaluation("COOLDOWN", null);
          continue;
        }

        const deduplicationKey = createIdempotencyKey("alert-event", {
          condition: rule.condition,
          observationKey: evaluation.observationKey,
          ruleId: rule.id
        });
        const [event] = await options.database
          .insert(alertEvents)
          .values({
            alertRuleId: rule.id,
            correlationId: job.correlationId,
            deduplicationKey,
            evaluationVersion: ALERT_EVALUATION_VERSION,
            observedUnit: evaluation.observedValue === null ? null : rule.thresholdUnit,
            observedValue: evaluation.observedValue,
            payload: {
              condition: rule.condition,
              informational: true,
              observedAt: evaluation.observedAt.toISOString(),
              sourceObservationIds: evaluation.sourceObservationIds,
              productId: rule.productId,
              routeId: rule.routeId,
              threshold: rule.threshold,
              thresholdUnit: rule.thresholdUnit
            },
            triggeredAt: evaluatedAt
          })
          .onConflictDoNothing({ target: alertEvents.deduplicationKey })
          .returning({ id: alertEvents.id });
        if (event === undefined) {
          await recordEvaluation("TRIGGERED", null);
          continue;
        }

        const destinations = await options.database
          .select({
            channel: notificationDestinations.channel,
            id: notificationDestinations.id
          })
          .from(alertRuleDestinations)
          .innerJoin(
            notificationDestinations,
            eq(alertRuleDestinations.destinationId, notificationDestinations.id)
          )
          .where(
            and(
              eq(alertRuleDestinations.alertRuleId, rule.id),
              isNull(notificationDestinations.disabledAt)
            )
          );
        for (const destination of destinations) {
          const inApp = destination.channel === "IN_APP";
          const external = destination.channel === "EMAIL" || destination.channel === "TELEGRAM";
          await options.database.insert(notificationDeliveries).values({
            alertEventId: event.id,
            attemptCount: inApp ? 1 : 0,
            channel: destination.channel,
            deliveredAt: inApp ? evaluatedAt : null,
            destinationId: destination.id,
            errorCategory: external ? null : inApp ? null : "CHANNEL_NOT_SUPPORTED",
            expiresAt: new Date(evaluatedAt.getTime() + 30 * 24 * 60 * 60_000),
            lastAttemptAt: inApp ? evaluatedAt : null,
            status: inApp ? "DELIVERED" : external ? "QUEUED" : "SUPPRESSED"
          });
        }
        await options.database
          .update(alertRules)
          .set({ lastTriggeredAt: evaluatedAt, updatedAt: evaluatedAt })
          .where(eq(alertRules.id, rule.id));
        await recordEvaluation("TRIGGERED", null);
        changed += 1;
      }
      await deliverDueNotifications({
        database: options.database,
        dispatcher: options.notificationDispatcher,
        encryptionKey: options.encryptionKey,
        now
      });
      return {
        ...result,
        recordsAccepted: accepted,
        recordsChanged: changed,
        recordsRead: rules.length,
        recordsRejected: rejected,
        staleRecords: stale
      };
    },

    async INGEST_SOURCE(job) {
      if (job.sourceId !== "MORPHO-API") {
        throw new WorkerJobError("UNSUPPORTED_SOURCE", false);
      }
      const [source, usdAsset] = await Promise.all([
        options.database
          .select({ id: sourceRegistry.id })
          .from(sourceRegistry)
          .where(
            and(
              eq(sourceRegistry.code, "CATALOG-MORPHO-API"),
              eq(sourceRegistry.publicationStatus, "PUBLISHED"),
              eq(sourceRegistry.status, "ACTIVE")
            )
          )
          .orderBy(desc(sourceRegistry.version))
          .limit(1),
        options.database
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.symbol, "USD"), eq(assets.assetType, "FIAT")))
          .limit(1)
      ]);
      const sourceId = source[0]?.id;
      const usdAssetId = usdAsset[0]?.id;
      if (sourceId === undefined || usdAssetId === undefined) {
        throw new WorkerJobError("CATALOG_BOOTSTRAP_REQUIRED", false);
      }

      const selectedRoutes = MORPHO_PRODUCTION_ROUTES.filter((route) => {
        const externalId = `${route.chainId}:${route.contractAddress.toLowerCase()}`;
        return job.externalEntityId === null || job.externalEntityId === externalId;
      });
      if (selectedRoutes.length === 0) throw new WorkerJobError("ROUTE_NOT_ADMITTED", false);

      let recordsRead = 0;
      let recordsAccepted = 0;
      let recordsRejected = 0;
      let recordsChanged = 0;
      let staleRecords = 0;
      let retryableFailures = 0;

      const persist = async (
        routeId: string,
        adapterResult: AdapterResult<NormalizedObservation>
      ): Promise<void> => {
        recordsRead += 1;
        if (adapterResult.kind !== "OBSERVATION") {
          recordsRejected += 1;
          if (adapterResult.retryable) retryableFailures += 1;
          return;
        }
        const observation = adapterResult.value;
        const status = databaseStatus(observation.status);
        const rawExpiry =
          observation.rawValue === null
            ? null
            : new Date(new Date(observation.fetchedAt).getTime() + 30 * 24 * 60 * 60_000);
        const appended = await appendSourceObservation(options.database, {
          adapterVersion: observation.adapterVersion,
          confidence: observation.confidence,
          correlationId: job.correlationId,
          entityId: routeId,
          entityType: "PRODUCT_ROUTE",
          externalEntityId: observation.externalEntityId,
          fetchedAt: new Date(observation.fetchedAt),
          idempotencyKey: observationIdempotencyKey(observation),
          metric: observation.metric,
          normalizedNumericValue: observation.normalizedValue,
          observedAt: new Date(observation.observedAt),
          provenanceHash: provenanceHash(observation),
          rawValue: observation.rawValue,
          rawValueExpiresAt: rawExpiry,
          sourceId,
          sourceRevision: observation.sourceRecordId ?? observation.externalEntityId,
          status,
          unit: observation.unit,
          valueType: "NUMERIC",
          verifiedAt: observation.verifiedAt === null ? null : new Date(observation.verifiedAt)
        });
        recordsAccepted += 1;
        if (!appended.inserted) return;
        recordsChanged += 1;
        if (status === "STALE") staleRecords += 1;
        const shared = {
          asOf: new Date(observation.observedAt),
          confidence: observation.confidence,
          routeId,
          selectionPolicyVersion: SELECTION_POLICY_VERSION,
          sourceObservationId: appended.observation.id,
          status
        } as const;
        if (observation.metric === "YIELD") {
          await options.database
            .insert(yieldSnapshots)
            .values({
              ...shared,
              calculationInputs: {
                sourceMetric: observation.metric,
                sourceUnit: observation.unit
              },
              calculationVersion: "morpho-direct-net-apy-v1",
              isPromotional: false,
              isVariable: true,
              netApy: ratioToPercentagePoints(observation.normalizedValue)
            })
            .onConflictDoNothing();
        } else if (observation.metric === "TVL") {
          await options.database
            .insert(tvlAumSnapshots)
            .values({
              ...shared,
              amount: observation.normalizedValue,
              metricKind: "TVL",
              quoteAssetId: usdAssetId
            })
            .onConflictDoNothing();
        } else if (observation.metric === "LIQUIDITY") {
          await options.database
            .insert(liquiditySnapshots)
            .values({
              ...shared,
              immediatelyAvailable: observation.normalizedValue,
              quoteAssetId: usdAssetId
            })
            .onConflictDoNothing();
        }
      };

      for (const identity of selectedRoutes) {
        const [route] = await options.database
          .select({ id: productRoutes.id })
          .from(productRoutes)
          .where(
            and(
              eq(productRoutes.slug, identity.routeSlug),
              eq(productRoutes.publicationStatus, "PUBLISHED"),
              isNull(productRoutes.effectiveTo)
            )
          )
          .limit(1);
        if (route === undefined) {
          recordsRead += 1;
          recordsRejected += 1;
          continue;
        }
        const externalEntityId = `${identity.chainId}:${identity.contractAddress.toLowerCase()}`;
        const [yieldResult, tvlResult, liquidityResult] = await Promise.all([
          options.morphoAdapter.fetchYield(externalEntityId),
          options.morphoAdapter.fetchTVLOrAUM(externalEntityId),
          options.morphoAdapter.fetchLiquidity(externalEntityId)
        ]);
        await persist(route.id, yieldResult);
        await persist(route.id, tvlResult);
        await persist(route.id, liquidityResult);
      }
      if (recordsAccepted === 0 && retryableFailures > 0) {
        throw new WorkerJobError("MORPHO_UPSTREAM_UNAVAILABLE", true);
      }
      return {
        outcome: "SUCCEEDED",
        recordsAccepted,
        recordsChanged,
        recordsRead,
        recordsRejected,
        staleRecords
      };
    },

    async RECALCULATE_RISK(job) {
      const calculatedAt = job.routeId === null ? now() : new Date(job.dataCutoff);
      const [methodology] = await options.database
        .select({ id: riskMethodologyVersions.id })
        .from(riskMethodologyVersions)
        .where(
          and(
            eq(riskMethodologyVersions.version, "1.0.0"),
            eq(riskMethodologyVersions.publicationStatus, "PUBLISHED")
          )
        )
        .limit(1);
      if (methodology === undefined) {
        throw new WorkerJobError("PUBLISHED_RISK_METHODOLOGY_REQUIRED", false);
      }
      const where =
        job.routeId === null
          ? and(eq(productRoutes.publicationStatus, "PUBLISHED"), isNull(productRoutes.effectiveTo))
          : and(
              eq(productRoutes.id, job.routeId),
              eq(productRoutes.publicationStatus, "PUBLISHED"),
              isNull(productRoutes.effectiveTo)
            );
      const routes = await options.database
        .select({ category: productCategories.code, id: productRoutes.id })
        .from(productRoutes)
        .innerJoin(products, eq(productRoutes.productId, products.id))
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(where);
      let changed = 0;
      for (const route of routes) {
        const composite = calculateCompositeRisk({
          calculatedAt: calculatedAt.toISOString(),
          category: route.category,
          factors: []
        });
        const [inserted] = await options.database
          .insert(compositeRiskSnapshots)
          .values({
            calculatedAt,
            calculationInputs: {
              evidenceCoveragePct: composite.evidenceCoveragePct,
              unavailableFactors: composite.unavailableFactors,
              unknownRiskProxy: "75"
            },
            calculationVersion: "risk-engine-v1.0.0",
            compositeScore: composite.score,
            confidence: "UNAVAILABLE",
            coverageRatio: new Decimal(composite.evidenceCoveragePct).div(100).toFixed(),
            explanation:
              "Provisional comparative score: every positively weighted factor without admitted evidence uses the published 75 unknown-risk proxy.",
            methodologyVersionId: methodology.id,
            resultStatus: "PARTIAL",
            routeId: route.id
          })
          .onConflictDoNothing()
          .returning({ id: compositeRiskSnapshots.id });
        if (inserted !== undefined) changed += 1;
      }
      return {
        outcome: "SUCCEEDED",
        recordsAccepted: routes.length,
        recordsChanged: changed,
        recordsRead: routes.length,
        recordsRejected: 0,
        staleRecords: 0
      };
    },

    async ROLLUP_HISTORY() {
      return emptyResult();
    }
  };
};

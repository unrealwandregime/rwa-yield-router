import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

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
  assets,
  compositeRiskSnapshots,
  liquiditySnapshots,
  notificationDeliveries,
  notificationDestinations,
  productCategories,
  productRoutes,
  products,
  riskFactorEvidence,
  riskFactorSnapshots,
  riskMethodologyCategoryWeights,
  riskMethodologyVersions,
  sourceObservations,
  sourceRegistry,
  tvlAumSnapshots,
  yieldHistoryRollups,
  yieldSnapshots,
  type Database
} from "@rwa-yield-router/database";
import {
  calculateCompositeRisk,
  riskFactorResultSchema,
  riskFactorSchema,
  riskMethodologySchema,
  type RiskFactorResult,
  type RiskMethodology
} from "@rwa-yield-router/risk-engine";
import type { NotificationDispatcher } from "@rwa-yield-router/notifications";
import Decimal from "decimal.js";
import { z } from "zod";

import { evaluateAlertSignal, isAlertCooldownActive } from "./alert-evaluator.js";
import { loadAlertSignal } from "./alert-signal-loader.js";
import { WorkerJobError, type WorkerJobHandlers, type WorkerJobResult } from "./jobs.js";
import {
  deliverDueNotifications,
  deliverNotificationById
} from "./notification-delivery-service.js";

const SELECTION_POLICY_VERSION = "official-source-identity-v1";
const ALERT_EVALUATION_VERSION = "sourced-condition-evaluator-v2";
const HISTORY_ROLLUP_VERSION = "daily-closing-net-apy-v1";
const HISTORY_ROLLUP_HORIZON_DAYS = 366;
const HISTORY_ROLLUP_MAX_BUCKETS = 25_000;
const SUPPORTED_RISK_CALCULATION_VERSION = "risk-engine-v1.0.0";

type WorkerDatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type TransactionRunner<TTransaction> = <TResult>(
  work: (transaction: TTransaction) => Promise<TResult>
) => Promise<TResult>;

export interface AtomicObservationPersistenceResult<TObservation> {
  readonly observation: TObservation;
  readonly observationInserted: boolean;
  readonly typedSnapshotInserted: boolean;
}

/**
 * Keeps the append-only observation and its typed analytical snapshot in the
 * same commit. The typed callback always runs for a duplicate observation so
 * an orphan left by an older interrupted release can be repaired safely.
 */
export const persistObservationAtomically = async <TTransaction, TObservation>(
  runInTransaction: TransactionRunner<TTransaction>,
  appendObservation: (
    transaction: TTransaction
  ) => Promise<Readonly<{ inserted: boolean; observation: TObservation }>>,
  persistTypedSnapshot: (transaction: TTransaction, observation: TObservation) => Promise<boolean>
): Promise<AtomicObservationPersistenceResult<TObservation>> =>
  runInTransaction(async (transaction) => {
    const appended = await appendObservation(transaction);
    const typedSnapshotInserted = await persistTypedSnapshot(transaction, appended.observation);
    return {
      observation: appended.observation,
      observationInserted: appended.inserted,
      typedSnapshotInserted
    };
  });

interface TriggeredAlertEventReference {
  readonly id: string;
  readonly triggeredAt: Date;
}

interface AlertDestinationReference {
  readonly channel: (typeof notificationDestinations.$inferSelect)["channel"];
  readonly id: string;
}

interface TriggeredAlertPersistenceOperations<TTransaction, TDestination> {
  readonly createOrLoadEvent: (
    transaction: TTransaction
  ) => Promise<Readonly<{ event: TriggeredAlertEventReference; inserted: boolean }>>;
  readonly loadDestinations: (transaction: TTransaction) => Promise<readonly TDestination[]>;
  readonly persistDeliveries: (
    transaction: TTransaction,
    event: TriggeredAlertEventReference,
    destinations: readonly TDestination[]
  ) => Promise<number>;
  readonly persistRuleState: (
    transaction: TTransaction,
    event: TriggeredAlertEventReference
  ) => Promise<void>;
}

export interface TriggeredAlertPersistenceResult {
  readonly changed: boolean;
  readonly deliveriesInserted: number;
  readonly eventInserted: boolean;
}

/**
 * Creates or reconciles an alert event, all of its delivery outbox rows, and
 * the rule transition in one transaction. Re-running after a prior release's
 * partial write loads the existing event and repairs missing deliveries.
 */
export const persistTriggeredAlertAtomically = async <TTransaction, TDestination>(
  runInTransaction: TransactionRunner<TTransaction>,
  operations: TriggeredAlertPersistenceOperations<TTransaction, TDestination>
): Promise<TriggeredAlertPersistenceResult> =>
  runInTransaction(async (transaction) => {
    const eventResult = await operations.createOrLoadEvent(transaction);
    const destinations = await operations.loadDestinations(transaction);
    const deliveriesInserted = await operations.persistDeliveries(
      transaction,
      eventResult.event,
      destinations
    );
    await operations.persistRuleState(transaction, eventResult.event);
    return {
      changed: eventResult.inserted || deliveriesInserted > 0,
      deliveriesInserted,
      eventInserted: eventResult.inserted
    };
  });

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

export const observationPersistenceCounts = (
  status: ReturnType<typeof databaseStatus>,
  persistence: Pick<
    AtomicObservationPersistenceResult<unknown>,
    "observationInserted" | "typedSnapshotInserted"
  >
): Readonly<{ accepted: 1; changed: 0 | 1; stale: 0 | 1 }> => ({
  accepted: 1,
  changed: persistence.observationInserted || persistence.typedSnapshotInserted ? 1 : 0,
  stale: status === "STALE" ? 1 : 0
});

export const ratioToPercentagePoints = (ratio: string): string =>
  new Decimal(ratio).mul(100).toFixed();

const boundedPercentageStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/u)
  .refine((value) => new Decimal(value).lte(100));

const persistedRiskInputsSchema = z
  .object({
    evidenceCoveragePct: boundedPercentageStringSchema,
    inputMetricIds: z.array(z.string().trim().min(1).max(128)).max(256)
  })
  .passthrough();

const supportedRiskMethodologyConfigurationSchema = z
  .object({
    maxAnnualPenaltyPp: boundedPercentageStringSchema,
    methodologyDocument: z.literal("RISK_METHODOLOGY.md"),
    minimumEvidenceCoveragePct: boundedPercentageStringSchema,
    semanticVersion: z.string().regex(/^1\.\d+\.\d+$/u),
    unknownRiskProxy: boundedPercentageStringSchema
  })
  .strict();

const supportedMissingEvidencePolicySchema = z
  .object({ mode: z.literal("UNKNOWN_RISK_PROXY") })
  .strict();

const supportedPenaltyConfigurationSchema = z
  .object({ maxAnnualPenaltyPp: boundedPercentageStringSchema })
  .strict();

export type PersistedRiskMethodologyVersion = Pick<
  typeof riskMethodologyVersions.$inferSelect,
  | "calculationVersion"
  | "configuration"
  | "createdAt"
  | "description"
  | "effectiveFrom"
  | "effectiveTo"
  | "id"
  | "publicationStatus"
  | "publishedAt"
  | "publishedByUserId"
  | "reviewedAt"
  | "reviewedByUserId"
  | "version"
>;

export interface PersistedRiskMethodologyWeight {
  readonly category: (typeof productCategories.$inferSelect)["code"];
  readonly factorCode: string;
  readonly methodologyVersionId: string;
  readonly missingEvidencePolicy: unknown;
  readonly penaltyConfiguration: unknown;
  readonly weight: string;
}

const methodologySelectionError = (code: string): WorkerJobError => new WorkerJobError(code, false);

/**
 * Resolves the single methodology whose publication and half-open effective
 * interval are valid at the calculation cutoff. Overlaps fail closed instead
 * of relying on database row order.
 */
export const selectEffectivePublishedRiskMethodology = (
  versions: ReadonlyArray<PersistedRiskMethodologyVersion>,
  calculatedAt: Date
): PersistedRiskMethodologyVersion => {
  const cutoff = calculatedAt.getTime();
  if (!Number.isFinite(cutoff)) {
    throw methodologySelectionError("INVALID_RISK_DATA_CUTOFF");
  }
  const effective = versions.filter((version) => {
    const publishedAt = version.publishedAt?.getTime();
    const effectiveFrom = version.effectiveFrom.getTime();
    const effectiveTo = version.effectiveTo?.getTime();
    return (
      version.publicationStatus === "PUBLISHED" &&
      publishedAt !== undefined &&
      Number.isFinite(publishedAt) &&
      publishedAt <= cutoff &&
      Number.isFinite(effectiveFrom) &&
      effectiveFrom <= cutoff &&
      (effectiveTo === undefined || (Number.isFinite(effectiveTo) && effectiveTo > cutoff))
    );
  });
  if (effective.length === 0) {
    throw methodologySelectionError("PUBLISHED_RISK_METHODOLOGY_REQUIRED");
  }
  if (effective.length !== 1) {
    throw methodologySelectionError("RISK_METHODOLOGY_INTERVAL_CONFLICT");
  }
  const selected = effective[0];
  if (selected === undefined) {
    throw methodologySelectionError("PUBLISHED_RISK_METHODOLOGY_REQUIRED");
  }
  return selected;
};

/**
 * Converts relational methodology configuration into the exact shape the
 * current risk engine supports. Unknown major versions, algorithms, policy
 * shapes, duplicate weights, or incomplete category tables are rejected.
 */
export const parseSupportedPersistedRiskMethodology = (
  version: PersistedRiskMethodologyVersion,
  weightRows: ReadonlyArray<PersistedRiskMethodologyWeight>
): RiskMethodology => {
  const configuration = supportedRiskMethodologyConfigurationSchema.safeParse(
    version.configuration
  );
  const publishedAt = version.publishedAt;
  const publicationTimesAreValid =
    publishedAt !== null &&
    version.reviewedAt !== null &&
    version.publishedByUserId !== null &&
    version.reviewedByUserId !== null &&
    version.publishedByUserId !== version.reviewedByUserId &&
    version.reviewedAt.getTime() <= publishedAt.getTime();
  if (
    version.publicationStatus !== "PUBLISHED" ||
    version.calculationVersion !== SUPPORTED_RISK_CALCULATION_VERSION ||
    !configuration.success ||
    configuration.data.semanticVersion !== version.version ||
    !publicationTimesAreValid
  ) {
    throw methodologySelectionError("UNSUPPORTED_RISK_METHODOLOGY");
  }

  const categoryWeights: Record<string, Record<string, string>> = {};
  const seen = new Set<string>();
  for (const row of weightRows) {
    const missingEvidencePolicy = supportedMissingEvidencePolicySchema.safeParse(
      row.missingEvidencePolicy
    );
    const penaltyConfiguration = supportedPenaltyConfigurationSchema.safeParse(
      row.penaltyConfiguration
    );
    const key = `${row.category}:${row.factorCode}`;
    if (
      row.methodologyVersionId !== version.id ||
      seen.has(key) ||
      !missingEvidencePolicy.success ||
      !penaltyConfiguration.success ||
      penaltyConfiguration.data.maxAnnualPenaltyPp !== configuration.data.maxAnnualPenaltyPp
    ) {
      throw methodologySelectionError("UNSUPPORTED_RISK_METHODOLOGY");
    }
    seen.add(key);
    let weightPercentage: string;
    try {
      weightPercentage = new Decimal(row.weight).mul(100).toFixed();
    } catch {
      throw methodologySelectionError("UNSUPPORTED_RISK_METHODOLOGY");
    }
    const weights = categoryWeights[row.category] ?? {};
    weights[row.factorCode] = weightPercentage;
    categoryWeights[row.category] = weights;
  }

  const methodology = riskMethodologySchema.safeParse({
    authorId: version.publishedByUserId,
    categoryWeights,
    createdAt: version.createdAt.toISOString(),
    effectiveAt: version.effectiveFrom.toISOString(),
    id: version.id,
    maxAnnualPenaltyPp: configuration.data.maxAnnualPenaltyPp,
    minimumEvidenceCoveragePct: configuration.data.minimumEvidenceCoveragePct,
    publishedAt: publishedAt?.toISOString() ?? null,
    releaseNotes: version.description,
    reviewerId: version.reviewedByUserId,
    semanticVersion: version.version,
    status: "PUBLISHED",
    unknownRiskProxy: configuration.data.unknownRiskProxy
  });
  if (!methodology.success) {
    throw methodologySelectionError("UNSUPPORTED_RISK_METHODOLOGY");
  }
  return methodology.data;
};

export interface PersistedRiskEvidenceInput {
  readonly freshnessThresholdSeconds: number | null;
  readonly fetchedAt: Date;
  readonly observationId: string;
  readonly observationStatus: (typeof sourceObservations.$inferSelect)["status"];
  readonly observedAt: Date;
  readonly sourceArchivedAt: Date | null;
  readonly sourcePublicationStatus: (typeof sourceRegistry.$inferSelect)["publicationStatus"];
  readonly sourcePublishedAt: Date | null;
  readonly sourceStatus: (typeof sourceRegistry.$inferSelect)["status"];
  readonly verifiedAt: Date | null;
}

export type RiskEvidenceDisposition = "CURRENT" | "INADMISSIBLE" | "STALE";

/** Freshness is inclusive at the configured source-policy boundary. */
export const classifyRiskEvidenceAtCutoff = (
  evidence: PersistedRiskEvidenceInput,
  calculationCutoff: Date
): RiskEvidenceDisposition => {
  const cutoff = calculationCutoff.getTime();
  const observedAt = evidence.observedAt.getTime();
  const fetchedAt = evidence.fetchedAt.getTime();
  const verifiedAt = evidence.verifiedAt?.getTime();
  const sourcePublishedAt = evidence.sourcePublishedAt?.getTime();
  const sourceArchivedAt = evidence.sourceArchivedAt?.getTime();
  if (evidence.observationStatus === "STALE") return "STALE";
  if (
    evidence.observationStatus !== "AVAILABLE" ||
    evidence.sourceStatus !== "ACTIVE" ||
    evidence.sourcePublicationStatus !== "PUBLISHED" ||
    evidence.freshnessThresholdSeconds === null ||
    !Number.isInteger(evidence.freshnessThresholdSeconds) ||
    evidence.freshnessThresholdSeconds <= 0 ||
    sourcePublishedAt === undefined ||
    !Number.isFinite(cutoff) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(fetchedAt) ||
    !Number.isFinite(sourcePublishedAt) ||
    sourcePublishedAt > cutoff ||
    observedAt > cutoff ||
    fetchedAt > cutoff ||
    fetchedAt < observedAt ||
    (verifiedAt !== undefined &&
      (!Number.isFinite(verifiedAt) || verifiedAt < observedAt || verifiedAt > cutoff)) ||
    (sourceArchivedAt !== undefined &&
      (!Number.isFinite(sourceArchivedAt) || sourceArchivedAt <= cutoff))
  ) {
    return "INADMISSIBLE";
  }
  return cutoff - observedAt <= evidence.freshnessThresholdSeconds * 1_000 ? "CURRENT" : "STALE";
};

export interface PersistedRiskFactorInput {
  readonly calculationCutoff: Date;
  readonly calculationVersion: string;
  readonly calculatedAt: Date;
  readonly confidence: RiskFactorResult["confidence"];
  readonly evidence: ReadonlyArray<PersistedRiskEvidenceInput>;
  readonly explanation: string;
  readonly factorCode: string;
  readonly inputMetrics: unknown;
  readonly resultStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  readonly score: string | null;
}

export interface NormalizedPersistedRiskFactor {
  readonly admitted: boolean;
  readonly result: RiskFactorResult | null;
}

export const normalizePersistedRiskFactor = (
  input: PersistedRiskFactorInput,
  methodologyVersion: string,
  expectedCalculationVersion: string
): NormalizedPersistedRiskFactor => {
  const factor = riskFactorSchema.safeParse(input.factorCode);
  if (!factor.success) return { admitted: false, result: null };

  const calculatedAt = input.calculatedAt.getTime();
  const calculationCutoff = input.calculationCutoff.getTime();
  if (!Number.isFinite(calculatedAt) || !Number.isFinite(calculationCutoff)) {
    return { admitted: false, result: null };
  }

  const parsedInputs = persistedRiskInputsSchema.safeParse(input.inputMetrics);
  const sourceObservationIds = [
    ...new Set(input.evidence.map((item) => item.observationId))
  ].sort();
  const evidenceIsCurrent =
    input.evidence.length > 0 &&
    input.evidence.every(
      (evidence) => classifyRiskEvidenceAtCutoff(evidence, input.calculationCutoff) === "CURRENT"
    );
  const common = {
    calculatedAt: input.calculatedAt.toISOString(),
    confidence: input.confidence,
    evidenceCoveragePct: parsedInputs.success ? parsedInputs.data.evidenceCoveragePct : "0",
    explanation:
      input.explanation.trim().slice(0, 2_000) ||
      "Persisted factor evidence is incomplete for this calculation.",
    factor: factor.data,
    inputMetrics: parsedInputs.success ? [...parsedInputs.data.inputMetricIds].sort() : [],
    methodologyVersion,
    sourceObservationIds
  } as const;
  const canAdmit =
    input.resultStatus === "AVAILABLE" &&
    input.score !== null &&
    input.confidence !== "UNAVAILABLE" &&
    input.confidence !== "STALE" &&
    input.calculationVersion === expectedCalculationVersion &&
    calculatedAt <= calculationCutoff &&
    parsedInputs.success &&
    evidenceIsCurrent;
  if (canAdmit) {
    const available = riskFactorResultSchema.safeParse({
      ...common,
      score: input.score,
      status: "AVAILABLE"
    });
    if (available.success) return { admitted: true, result: available.data };
  }

  return {
    admitted: false,
    result: riskFactorResultSchema.parse({
      ...common,
      confidence: "UNAVAILABLE",
      evidenceCoveragePct: "0",
      explanation: "No admissible sourced evidence is available for this risk factor.",
      score: null,
      status: "UNAVAILABLE"
    })
  };
};

export interface CompositeRiskPersistence {
  readonly compositeScore: string | null;
  readonly coverageRatio: string;
  readonly evidenceCoveragePct: string;
  readonly explanation: string;
  readonly resultStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  readonly unavailableFactors: ReadonlyArray<string>;
}

export const buildCompositeRiskPersistence = (
  category: Parameters<typeof calculateCompositeRisk>[0]["category"],
  calculatedAt: Date,
  factors: ReadonlyArray<RiskFactorResult>,
  methodology?: RiskMethodology
): CompositeRiskPersistence => {
  const composite = calculateCompositeRisk({
    calculatedAt: calculatedAt.toISOString(),
    category,
    factors: [...factors],
    ...(methodology === undefined ? {} : { methodology })
  });
  const coverageRatio = new Decimal(composite.evidenceCoveragePct).div(100).toFixed();
  if (new Decimal(composite.evidenceCoveragePct).isZero()) {
    return {
      compositeScore: null,
      coverageRatio,
      evidenceCoveragePct: composite.evidenceCoveragePct,
      explanation:
        "Comparative risk is unavailable because no positively weighted factor has admissible sourced evidence. The unknown-risk proxy is not published as an observed score.",
      resultStatus: "UNAVAILABLE",
      unavailableFactors: composite.unavailableFactors
    };
  }
  return {
    compositeScore: composite.score,
    coverageRatio,
    evidenceCoveragePct: composite.evidenceCoveragePct,
    explanation:
      composite.status === "VERIFIED"
        ? "Comparative risk is calculated from admissible sourced factor evidence."
        : "Comparative risk is provisional: unavailable weighted factors use the published unknown-risk proxy for ranking only.",
    resultStatus: composite.status === "VERIFIED" ? "AVAILABLE" : "PARTIAL",
    unavailableFactors: composite.unavailableFactors
  };
};

const confidenceFromAdmittedFactors = (
  factors: ReadonlyArray<RiskFactorResult>
): RiskFactorResult["confidence"] => {
  const weakestFirst: ReadonlyArray<RiskFactorResult["confidence"]> = [
    "UNAVAILABLE",
    "STALE",
    "ESTIMATED",
    "THIRD_PARTY",
    "MANUALLY_VERIFIED",
    "ISSUER_REPORTED",
    "ONCHAIN_DERIVED",
    "DIRECT_API",
    "VERIFIED_OFFICIAL"
  ];
  const available = new Set(
    factors.filter((factor) => factor.status === "AVAILABLE").map((factor) => factor.confidence)
  );
  return weakestFirst.find((confidence) => available.has(confidence)) ?? "UNAVAILABLE";
};

export const resolveHistoryRollupWindow = (
  requestedCutoff: string | null,
  currentTime: Date
): Readonly<{ cutoff: Date; completedBefore: Date; horizonStart: Date }> => {
  const cutoff = requestedCutoff === null ? new Date(currentTime) : new Date(requestedCutoff);
  if (Number.isNaN(cutoff.getTime())) throw new WorkerJobError("INVALID_ROLLUP_CUTOFF", false);
  const completedBefore = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate())
  );
  const horizonStart = new Date(
    completedBefore.getTime() - HISTORY_ROLLUP_HORIZON_DAYS * 24 * 60 * 60_000
  );
  return { completedBefore, cutoff, horizonStart };
};

const rollupCountsSchema = z.object({
  records_accepted: z.number().int().nonnegative(),
  records_changed: z.number().int().nonnegative(),
  records_read: z.number().int().nonnegative()
});

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
  const runInTransaction: TransactionRunner<WorkerDatabaseTransaction> = (work) =>
    options.database.transaction(work);

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
        const persistence = await persistTriggeredAlertAtomically<
          WorkerDatabaseTransaction,
          AlertDestinationReference
        >(runInTransaction, {
          async createOrLoadEvent(transaction) {
            const [inserted] = await transaction
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
              .returning({ id: alertEvents.id, triggeredAt: alertEvents.triggeredAt });
            if (inserted !== undefined) return { event: inserted, inserted: true };
            const [existing] = await transaction
              .select({ id: alertEvents.id, triggeredAt: alertEvents.triggeredAt })
              .from(alertEvents)
              .where(eq(alertEvents.deduplicationKey, deduplicationKey))
              .limit(1);
            if (existing === undefined)
              throw new WorkerJobError("ALERT_EVENT_RECONCILIATION_FAILED", true);
            return { event: existing, inserted: false };
          },
          async loadDestinations(transaction) {
            return transaction
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
          },
          async persistDeliveries(transaction, event, destinations) {
            if (destinations.length === 0) return 0;
            const inserted = await transaction
              .insert(notificationDeliveries)
              .values(
                destinations.map((destination) => {
                  const inApp = destination.channel === "IN_APP";
                  const external =
                    destination.channel === "EMAIL" || destination.channel === "TELEGRAM";
                  return {
                    alertEventId: event.id,
                    attemptCount: inApp ? 1 : 0,
                    channel: destination.channel,
                    deliveredAt: inApp ? event.triggeredAt : null,
                    destinationId: destination.id,
                    errorCategory: external ? null : inApp ? null : "CHANNEL_NOT_SUPPORTED",
                    expiresAt: new Date(event.triggeredAt.getTime() + 30 * 24 * 60 * 60_000),
                    lastAttemptAt: inApp ? event.triggeredAt : null,
                    status: inApp ? "DELIVERED" : external ? "QUEUED" : "SUPPRESSED"
                  } as const;
                })
              )
              .onConflictDoNothing({
                target: [notificationDeliveries.alertEventId, notificationDeliveries.destinationId]
              })
              .returning({ id: notificationDeliveries.id });
            return inserted.length;
          },
          async persistRuleState(transaction, event) {
            await transaction
              .update(alertRules)
              .set({
                configuration: {
                  ...storedConfiguration,
                  lastEvaluation: {
                    evaluatedAt: evaluatedAt.toISOString(),
                    reason: null,
                    status: "TRIGGERED"
                  }
                },
                lastEvaluatedAt: evaluatedAt,
                lastTriggeredAt: event.triggeredAt,
                updatedAt: evaluatedAt
              })
              .where(eq(alertRules.id, rule.id));
          }
        });
        if (persistence.changed) changed += 1;
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
        const idempotencyKey = observationIdempotencyKey(observation);
        const persisted = await persistObservationAtomically(
          runInTransaction,
          async (transaction) => {
            const [inserted] = await transaction
              .insert(sourceObservations)
              .values({
                adapterVersion: observation.adapterVersion,
                confidence: observation.confidence,
                correlationId: job.correlationId,
                entityId: routeId,
                entityType: "PRODUCT_ROUTE",
                externalEntityId: observation.externalEntityId,
                fetchedAt: new Date(observation.fetchedAt),
                idempotencyKey,
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
                verifiedAt:
                  observation.verifiedAt === null ? null : new Date(observation.verifiedAt)
              })
              .onConflictDoNothing({ target: sourceObservations.idempotencyKey })
              .returning();
            if (inserted !== undefined) return { inserted: true, observation: inserted };
            const [existing] = await transaction
              .select()
              .from(sourceObservations)
              .where(eq(sourceObservations.idempotencyKey, idempotencyKey))
              .limit(1);
            if (existing === undefined)
              throw new WorkerJobError("OBSERVATION_RECONCILIATION_FAILED", true);
            if (
              existing.entityId !== routeId ||
              existing.entityType !== "PRODUCT_ROUTE" ||
              existing.externalEntityId !== observation.externalEntityId ||
              existing.metric !== observation.metric ||
              existing.sourceId !== sourceId
            )
              throw new WorkerJobError("OBSERVATION_IDEMPOTENCY_CONFLICT", false);
            return { inserted: false, observation: existing };
          },
          async (transaction, persistedObservation) => {
            const normalizedValue = persistedObservation.normalizedNumericValue;
            if (normalizedValue === null)
              throw new WorkerJobError("NORMALIZED_OBSERVATION_VALUE_REQUIRED", false);
            const shared = {
              asOf: persistedObservation.observedAt,
              confidence: persistedObservation.confidence,
              routeId,
              selectionPolicyVersion: SELECTION_POLICY_VERSION,
              sourceObservationId: persistedObservation.id,
              status: persistedObservation.status
            } as const;
            if (persistedObservation.metric === "YIELD") {
              const [inserted] = await transaction
                .insert(yieldSnapshots)
                .values({
                  ...shared,
                  calculationInputs: {
                    sourceMetric: persistedObservation.metric,
                    sourceUnit: persistedObservation.unit
                  },
                  calculationVersion: "morpho-direct-net-apy-v1",
                  isPromotional: false,
                  isVariable: true,
                  netApy: ratioToPercentagePoints(normalizedValue)
                })
                .onConflictDoNothing()
                .returning({ id: yieldSnapshots.id });
              return inserted !== undefined;
            }
            if (persistedObservation.metric === "TVL") {
              const [inserted] = await transaction
                .insert(tvlAumSnapshots)
                .values({
                  ...shared,
                  amount: normalizedValue,
                  metricKind: "TVL",
                  quoteAssetId: usdAssetId
                })
                .onConflictDoNothing()
                .returning({ id: tvlAumSnapshots.id });
              return inserted !== undefined;
            }
            if (persistedObservation.metric === "LIQUIDITY") {
              const [inserted] = await transaction
                .insert(liquiditySnapshots)
                .values({
                  ...shared,
                  immediatelyAvailable: normalizedValue,
                  quoteAssetId: usdAssetId
                })
                .onConflictDoNothing()
                .returning({ id: liquiditySnapshots.id });
              return inserted !== undefined;
            }
            throw new WorkerJobError("UNSUPPORTED_MORPHO_METRIC", false);
          }
        );
        const counts = observationPersistenceCounts(status, persisted);
        recordsAccepted += counts.accepted;
        recordsChanged += counts.changed;
        staleRecords += counts.stale;
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
      const methodologyVersions = await options.database
        .select({
          calculationVersion: riskMethodologyVersions.calculationVersion,
          configuration: riskMethodologyVersions.configuration,
          createdAt: riskMethodologyVersions.createdAt,
          description: riskMethodologyVersions.description,
          effectiveFrom: riskMethodologyVersions.effectiveFrom,
          effectiveTo: riskMethodologyVersions.effectiveTo,
          id: riskMethodologyVersions.id,
          publicationStatus: riskMethodologyVersions.publicationStatus,
          publishedAt: riskMethodologyVersions.publishedAt,
          publishedByUserId: riskMethodologyVersions.publishedByUserId,
          reviewedAt: riskMethodologyVersions.reviewedAt,
          reviewedByUserId: riskMethodologyVersions.reviewedByUserId,
          version: riskMethodologyVersions.version
        })
        .from(riskMethodologyVersions)
        .where(eq(riskMethodologyVersions.publicationStatus, "PUBLISHED"));
      const methodologyVersion = selectEffectivePublishedRiskMethodology(
        methodologyVersions,
        calculatedAt
      );
      const methodologyWeightRows = await options.database
        .select({
          category: productCategories.code,
          factorCode: riskMethodologyCategoryWeights.factorCode,
          methodologyVersionId: riskMethodologyCategoryWeights.methodologyVersionId,
          missingEvidencePolicy: riskMethodologyCategoryWeights.missingEvidencePolicy,
          penaltyConfiguration: riskMethodologyCategoryWeights.penaltyConfiguration,
          weight: riskMethodologyCategoryWeights.weight
        })
        .from(riskMethodologyCategoryWeights)
        .innerJoin(
          productCategories,
          eq(riskMethodologyCategoryWeights.categoryId, productCategories.id)
        )
        .where(eq(riskMethodologyCategoryWeights.methodologyVersionId, methodologyVersion.id));
      const methodology = parseSupportedPersistedRiskMethodology(
        methodologyVersion,
        methodologyWeightRows
      );
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
      let evidenceRecordsRead = 0;
      let factorRecordsRead = 0;
      let rejected = 0;
      const staleObservationIds = new Set<string>();
      for (const route of routes) {
        const factorRows = await options.database
          .selectDistinctOn([riskFactorSnapshots.factorCode], {
            calculatedAt: riskFactorSnapshots.calculatedAt,
            calculationVersion: riskFactorSnapshots.calculationVersion,
            confidence: riskFactorSnapshots.confidence,
            explanation: riskFactorSnapshots.explanation,
            factorCode: riskFactorSnapshots.factorCode,
            id: riskFactorSnapshots.id,
            inputMetrics: riskFactorSnapshots.inputMetrics,
            resultStatus: riskFactorSnapshots.resultStatus,
            score: riskFactorSnapshots.score
          })
          .from(riskFactorSnapshots)
          .where(
            and(
              eq(riskFactorSnapshots.routeId, route.id),
              eq(riskFactorSnapshots.methodologyVersionId, methodologyVersion.id),
              lte(riskFactorSnapshots.calculatedAt, calculatedAt)
            )
          )
          .orderBy(
            riskFactorSnapshots.factorCode,
            desc(riskFactorSnapshots.calculatedAt),
            desc(riskFactorSnapshots.id)
          );
        factorRecordsRead += factorRows.length;
        const factorIds = factorRows.map((factor) => factor.id);
        const evidenceRows =
          factorIds.length === 0
            ? []
            : await options.database
                .select({
                  factorId: riskFactorEvidence.riskFactorSnapshotId,
                  freshnessThresholdSeconds: sourceRegistry.freshnessThresholdSeconds,
                  fetchedAt: sourceObservations.fetchedAt,
                  observationId: riskFactorEvidence.sourceObservationId,
                  observationStatus: sourceObservations.status,
                  observedAt: sourceObservations.observedAt,
                  sourceArchivedAt: sourceRegistry.archivedAt,
                  sourcePublicationStatus: sourceRegistry.publicationStatus,
                  sourcePublishedAt: sourceRegistry.publishedAt,
                  sourceStatus: sourceRegistry.status,
                  verifiedAt: sourceObservations.verifiedAt
                })
                .from(riskFactorEvidence)
                .innerJoin(
                  sourceObservations,
                  eq(riskFactorEvidence.sourceObservationId, sourceObservations.id)
                )
                .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
                .where(inArray(riskFactorEvidence.riskFactorSnapshotId, factorIds));
        evidenceRecordsRead += evidenceRows.length;
        const evidenceByFactor = new Map<string, PersistedRiskEvidenceInput[]>();
        for (const evidence of evidenceRows) {
          const values = evidenceByFactor.get(evidence.factorId) ?? [];
          const input: PersistedRiskEvidenceInput = {
            freshnessThresholdSeconds: evidence.freshnessThresholdSeconds,
            fetchedAt: evidence.fetchedAt,
            observationId: evidence.observationId,
            observationStatus: evidence.observationStatus,
            observedAt: evidence.observedAt,
            sourceArchivedAt: evidence.sourceArchivedAt,
            sourcePublicationStatus: evidence.sourcePublicationStatus,
            sourcePublishedAt: evidence.sourcePublishedAt,
            sourceStatus: evidence.sourceStatus,
            verifiedAt: evidence.verifiedAt
          };
          values.push(input);
          evidenceByFactor.set(evidence.factorId, values);
          if (classifyRiskEvidenceAtCutoff(input, calculatedAt) === "STALE") {
            staleObservationIds.add(evidence.observationId);
          }
        }
        const normalizedFactors = factorRows.map((factor) => ({
          factor,
          normalized: normalizePersistedRiskFactor(
            {
              calculationCutoff: calculatedAt,
              calculationVersion: factor.calculationVersion,
              calculatedAt: factor.calculatedAt,
              confidence: factor.confidence,
              evidence: evidenceByFactor.get(factor.id) ?? [],
              explanation: factor.explanation,
              factorCode: factor.factorCode,
              inputMetrics: factor.inputMetrics,
              resultStatus: factor.resultStatus,
              score: factor.score
            },
            methodology.semanticVersion,
            methodologyVersion.calculationVersion
          )
        }));
        rejected += normalizedFactors.filter(
          ({ factor, normalized }) =>
            normalized.result === null ||
            (factor.resultStatus === "AVAILABLE" && !normalized.admitted)
        ).length;
        const factors = normalizedFactors.flatMap(({ normalized }) =>
          normalized.result === null ? [] : [normalized.result]
        );
        const composite = buildCompositeRiskPersistence(
          route.category,
          calculatedAt,
          factors,
          methodology
        );
        const sourceObservationIds = [
          ...new Set(
            normalizedFactors.flatMap(({ normalized }) =>
              normalized.admitted && normalized.result !== null
                ? normalized.result.sourceObservationIds
                : []
            )
          )
        ].sort();
        const [inserted] = await options.database
          .insert(compositeRiskSnapshots)
          .values({
            calculatedAt,
            calculationInputs: {
              evidenceCoveragePct: composite.evidenceCoveragePct,
              factorSnapshotIds: factorRows.map((factor) => factor.id).sort(),
              sourceObservationIds,
              unavailableFactors: composite.unavailableFactors,
              unknownRiskProxy: methodology.unknownRiskProxy,
              unknownRiskProxyApplied: composite.resultStatus === "PARTIAL"
            },
            calculationVersion: methodologyVersion.calculationVersion,
            compositeScore: composite.compositeScore,
            confidence:
              composite.resultStatus === "AVAILABLE"
                ? confidenceFromAdmittedFactors(factors)
                : composite.resultStatus === "PARTIAL"
                  ? "ESTIMATED"
                  : "UNAVAILABLE",
            coverageRatio: composite.coverageRatio,
            explanation: composite.explanation,
            methodologyVersionId: methodologyVersion.id,
            resultStatus: composite.resultStatus,
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
        recordsRead:
          routes.length +
          evidenceRecordsRead +
          factorRecordsRead +
          methodologyVersions.length +
          methodologyWeightRows.length,
        recordsRejected: rejected,
        staleRecords: staleObservationIds.size
      };
    },

    async ROLLUP_HISTORY(job) {
      const window = resolveHistoryRollupWindow(job.cutoff, now());
      const rows = await options.database.execute(sql`
        with ranked as (
          select
            ${yieldSnapshots.id} as "source_yield_snapshot_id",
            ${yieldSnapshots.routeId} as "route_id",
            date_trunc('day', ${yieldSnapshots.asOf}, 'UTC') as "bucket_start",
            ${yieldSnapshots.asOf} as "as_of",
            ${yieldSnapshots.netApy} as "net_apy",
            ${yieldSnapshots.confidence} as "confidence",
            ${yieldSnapshots.status} as "status",
            row_number() over (
              partition by ${yieldSnapshots.routeId}, date_trunc('day', ${yieldSnapshots.asOf}, 'UTC')
              order by
                ${yieldSnapshots.asOf} desc,
                ${sourceRegistry.priority} asc,
                ${sourceObservations.fetchedAt} desc,
                ${sourceObservations.provenanceHash} asc,
                ${yieldSnapshots.calculationVersion} asc,
                ${sourceRegistry.code} asc,
                ${sourceObservations.idempotencyKey} asc
            ) as "bucket_rank"
          from ${yieldSnapshots}
          inner join ${sourceObservations}
            on ${yieldSnapshots.sourceObservationId} = ${sourceObservations.id}
          inner join ${sourceRegistry}
            on ${sourceObservations.sourceId} = ${sourceRegistry.id}
          where ${yieldSnapshots.routeId} is not null
            and ${yieldSnapshots.netApy} is not null
            and ${yieldSnapshots.status} = 'AVAILABLE'
            and ${yieldSnapshots.asOf} >= ${window.horizonStart}
            and ${yieldSnapshots.asOf} < ${window.completedBefore}
            and ${yieldSnapshots.createdAt} <= ${window.cutoff}
            and ${sourceObservations.fetchedAt} <= ${window.cutoff}
            and (${sourceObservations.verifiedAt} is null or ${sourceObservations.verifiedAt} <= ${window.cutoff})
        ), selected as (
          select
            "source_yield_snapshot_id",
            "route_id",
            "bucket_start",
            "as_of",
            "net_apy",
            "confidence",
            "status"
          from ranked
          where "bucket_rank" = 1
          order by "bucket_start" desc, "route_id"
          limit ${HISTORY_ROLLUP_MAX_BUCKETS + 1}
        ), upserted as (
          insert into ${yieldHistoryRollups} (
            "route_id",
            "bucket_start",
            "as_of",
            "source_yield_snapshot_id",
            "net_apy",
            "confidence",
            "status",
            "data_cutoff",
            "calculation_version"
          )
          select
            "route_id",
            "bucket_start",
            "as_of",
            "source_yield_snapshot_id",
            "net_apy",
            "confidence",
            "status",
            ${window.cutoff},
            ${HISTORY_ROLLUP_VERSION}
          from selected
          where (select count(*) from selected) <= ${HISTORY_ROLLUP_MAX_BUCKETS}
          on conflict ("route_id", "bucket_start", "calculation_version") do update set
            "as_of" = excluded."as_of",
            "source_yield_snapshot_id" = excluded."source_yield_snapshot_id",
            "net_apy" = excluded."net_apy",
            "confidence" = excluded."confidence",
            "status" = excluded."status",
            "data_cutoff" = excluded."data_cutoff",
            "updated_at" = now()
          where "yield_history_rollups"."source_yield_snapshot_id" <>
            excluded."source_yield_snapshot_id"
          returning "id"
        )
        select
          (select count(*)::integer from selected) as "records_read",
          (select count(*)::integer from selected) as "records_accepted",
          (select count(*)::integer from upserted) as "records_changed"
      `);
      const counts = rollupCountsSchema.parse(rows[0]);
      if (counts.records_read > HISTORY_ROLLUP_MAX_BUCKETS) {
        throw new WorkerJobError("ROLLUP_HISTORY_CAPACITY_EXCEEDED", false);
      }
      return {
        outcome: "SUCCEEDED",
        recordsAccepted: counts.records_accepted,
        recordsChanged: counts.records_changed,
        recordsRead: counts.records_read,
        recordsRejected: 0,
        staleRecords: 0
      };
    }
  };
};

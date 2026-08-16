import "server-only";

import { getServerConfig } from "@rwa-yield-router/config";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  getDatabase,
  productRoutes,
  sourceObservations,
  sourceRegistry,
  yieldHistoryRollups,
  yieldSnapshots,
  type SourceObservation,
  type YieldSnapshot
} from "@rwa-yield-router/database";

type SourceRegistryRow = typeof sourceRegistry.$inferSelect;

interface ProvenanceProjection {
  readonly observationAdapterVersion: string;
  readonly observationConfidence: SourceObservation["confidence"];
  readonly observationFetchedAt: Date;
  readonly observationId: string;
  readonly observationMetric: string;
  readonly observationObservedAt: Date;
  readonly observationSourceRevision: string;
  readonly observationStatus: SourceObservation["status"];
  readonly observationUnit: string;
  readonly observationVerifiedAt: Date | null;
  readonly sourceCode: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceType: SourceRegistryRow["sourceType"];
  readonly sourceUrl: string;
}

const provenanceSelection = {
  observationAdapterVersion: sourceObservations.adapterVersion,
  observationConfidence: sourceObservations.confidence,
  observationFetchedAt: sourceObservations.fetchedAt,
  observationId: sourceObservations.id,
  observationMetric: sourceObservations.metric,
  observationObservedAt: sourceObservations.observedAt,
  observationSourceRevision: sourceObservations.sourceRevision,
  observationStatus: sourceObservations.status,
  observationUnit: sourceObservations.unit,
  observationVerifiedAt: sourceObservations.verifiedAt,
  sourceCode: sourceRegistry.code,
  sourceId: sourceRegistry.id,
  sourceName: sourceRegistry.name,
  sourceType: sourceRegistry.sourceType,
  sourceUrl: sourceRegistry.canonicalUrl
} as const;

const observationFrom = (row: ProvenanceProjection) => ({
  adapterVersion: row.observationAdapterVersion,
  confidence: row.observationConfidence,
  fetchedAt: row.observationFetchedAt.toISOString(),
  id: row.observationId,
  metric: row.observationMetric,
  observedAt: row.observationObservedAt.toISOString(),
  sourceRevision: row.observationSourceRevision,
  status: row.observationStatus,
  unit: row.observationUnit,
  verifiedAt: row.observationVerifiedAt?.toISOString() ?? null
});

const sourceFrom = (row: ProvenanceProjection) => ({
  code: row.sourceCode,
  id: row.sourceId,
  name: row.sourceName,
  type: row.sourceType,
  url: row.sourceUrl
});

export interface YieldHistoryPoint {
  readonly at: string;
  readonly confidence: YieldSnapshot["confidence"];
  readonly observation: {
    readonly adapterVersion: string;
    readonly confidence: SourceObservation["confidence"];
    readonly fetchedAt: string;
    readonly id: string;
    readonly metric: string;
    readonly observedAt: string;
    readonly sourceRevision: string;
    readonly status: SourceObservation["status"];
    readonly unit: string;
    readonly verifiedAt: string | null;
  };
  readonly rollup: {
    readonly bucketStart: string;
    readonly calculationVersion: string;
    readonly dataCutoff: string;
    readonly id: string;
    readonly updatedAt: string;
  } | null;
  readonly snapshot: {
    readonly asOf: string;
    readonly calculationVersion: string;
    readonly confidence: YieldSnapshot["confidence"];
    readonly id: string;
    readonly selectionPolicyVersion: string;
    readonly status: YieldSnapshot["status"];
  };
  readonly source: {
    readonly code: string;
    readonly id: string;
    readonly name: string;
    readonly type: SourceRegistryRow["sourceType"];
    readonly url: string;
  };
  readonly status: YieldSnapshot["status"];
  readonly value: string;
}

export async function getYieldHistory(routeSlug: string): Promise<YieldHistoryPoint[]> {
  if (getServerConfig().databaseUrl === undefined) return [];
  try {
    const database = getDatabase();
    const [route] = await database
      .select({ id: productRoutes.id })
      .from(productRoutes)
      .where(
        and(
          eq(productRoutes.slug, routeSlug),
          eq(productRoutes.lifecycleStatus, "ACTIVE"),
          eq(productRoutes.publicationStatus, "PUBLISHED"),
          isNull(productRoutes.archivedAt),
          isNull(productRoutes.effectiveTo)
        )
      )
      .limit(1);
    if (route === undefined) return [];
    const rollups = await database
      .select({
        ...provenanceSelection,
        at: yieldHistoryRollups.asOf,
        pointConfidence: yieldHistoryRollups.confidence,
        pointStatus: yieldHistoryRollups.status,
        rollupBucketStart: yieldHistoryRollups.bucketStart,
        rollupCalculationVersion: yieldHistoryRollups.calculationVersion,
        rollupDataCutoff: yieldHistoryRollups.dataCutoff,
        rollupId: yieldHistoryRollups.id,
        rollupUpdatedAt: yieldHistoryRollups.updatedAt,
        snapshotAsOf: yieldSnapshots.asOf,
        snapshotCalculationVersion: yieldSnapshots.calculationVersion,
        snapshotConfidence: yieldSnapshots.confidence,
        snapshotId: yieldSnapshots.id,
        snapshotSelectionPolicyVersion: yieldSnapshots.selectionPolicyVersion,
        snapshotStatus: yieldSnapshots.status,
        value: yieldHistoryRollups.netApy
      })
      .from(yieldHistoryRollups)
      .innerJoin(yieldSnapshots, eq(yieldHistoryRollups.sourceYieldSnapshotId, yieldSnapshots.id))
      .innerJoin(sourceObservations, eq(yieldSnapshots.sourceObservationId, sourceObservations.id))
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(
        and(
          eq(yieldHistoryRollups.routeId, route.id),
          eq(yieldSnapshots.routeId, route.id),
          eq(yieldHistoryRollups.status, "AVAILABLE")
        )
      )
      .orderBy(desc(yieldHistoryRollups.bucketStart))
      .limit(365);
    if (rollups.length > 0) {
      return rollups
        .map((row) => ({
          at: row.at.toISOString(),
          confidence: row.pointConfidence,
          observation: observationFrom(row),
          rollup: {
            bucketStart: row.rollupBucketStart.toISOString(),
            calculationVersion: row.rollupCalculationVersion,
            dataCutoff: row.rollupDataCutoff.toISOString(),
            id: row.rollupId,
            updatedAt: row.rollupUpdatedAt.toISOString()
          },
          snapshot: {
            asOf: row.snapshotAsOf.toISOString(),
            calculationVersion: row.snapshotCalculationVersion,
            confidence: row.snapshotConfidence,
            id: row.snapshotId,
            selectionPolicyVersion: row.snapshotSelectionPolicyVersion,
            status: row.snapshotStatus
          },
          source: sourceFrom(row),
          status: row.pointStatus,
          value: row.value
        }))
        .reverse();
    }
    const rows = await database
      .select({
        ...provenanceSelection,
        at: yieldSnapshots.asOf,
        pointConfidence: yieldSnapshots.confidence,
        pointStatus: yieldSnapshots.status,
        snapshotCalculationVersion: yieldSnapshots.calculationVersion,
        snapshotId: yieldSnapshots.id,
        snapshotSelectionPolicyVersion: yieldSnapshots.selectionPolicyVersion,
        value: yieldSnapshots.netApy
      })
      .from(yieldSnapshots)
      .innerJoin(sourceObservations, eq(yieldSnapshots.sourceObservationId, sourceObservations.id))
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(
        and(
          eq(yieldSnapshots.routeId, route.id),
          eq(yieldSnapshots.status, "AVAILABLE"),
          isNotNull(yieldSnapshots.netApy)
        )
      )
      .orderBy(desc(yieldSnapshots.asOf))
      .limit(365);
    return rows
      .flatMap((row) =>
        row.value === null
          ? []
          : [
              {
                at: row.at.toISOString(),
                confidence: row.pointConfidence,
                observation: observationFrom(row),
                rollup: null,
                snapshot: {
                  asOf: row.at.toISOString(),
                  calculationVersion: row.snapshotCalculationVersion,
                  confidence: row.pointConfidence,
                  id: row.snapshotId,
                  selectionPolicyVersion: row.snapshotSelectionPolicyVersion,
                  status: row.pointStatus
                },
                source: sourceFrom(row),
                status: row.pointStatus,
                value: row.value
              }
            ]
      )
      .reverse();
  } catch {
    return [];
  }
}

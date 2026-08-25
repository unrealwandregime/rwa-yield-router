import "server-only";

import { getServerConfig } from "@rwa-yield-router/config";
import {
  adminAuditLogs,
  catalogImportRecords,
  chains,
  compositeRiskSnapshots,
  eligibilityRules,
  getDatabase,
  issuers,
  jurisdictions,
  liquiditySnapshots,
  productCategories,
  productRoutes,
  products,
  productYieldSources,
  protocols,
  redemptionTerms,
  riskFactorEvidence,
  riskFactorSnapshots,
  riskMethodologyCategoryWeights,
  riskMethodologyVersions,
  sourceObservations,
  sourceRegistry,
  tvlAumSnapshots,
  yieldSnapshots,
  yieldSources
} from "@rwa-yield-router/database";
import { RISK_METHODOLOGY_V1, type RiskMethodology } from "@rwa-yield-router/risk-engine";
import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { unstable_noStore as noStore } from "next/cache";
import { getCatalog, type CatalogMetricState, type CatalogRecord } from "@/lib/catalog";
import {
  buildDatabaseMethodology,
  mergeCatalogPublication,
  metricStateHasDisplayValue,
  resolveMetricState,
  type EffectiveMethodology
} from "@/lib/public-read-model-core";
import {
  parseCompositeRiskEvidenceInput,
  validateCompositeRiskObservationIds
} from "@/lib/public-risk-provenance";

const MAX_CATALOG_VERSIONS = 1_000;
const DEFAULT_FRESHNESS_SECONDS = {
  aumTvl: 30 * 60,
  liquidity: 15 * 60,
  risk: 60 * 60,
  yield: 15 * 60
} as const;

type SourceStatus = "ACTIVE" | "DEGRADED" | "DISABLED" | "REMOVED";

interface PublicSourceEvidence {
  readonly archivedAt: Date | null;
  readonly confidence: string;
  readonly name: string;
  readonly publishedAt: Date | null;
  readonly publicationStatus: string;
  readonly sourceId: string;
  readonly sourceStatus: SourceStatus;
  readonly type: string;
  readonly url: string;
  readonly verifiedAt: Date;
}

export interface PersistedRouteEvidence {
  readonly aumOrTvlUsd: string | null;
  readonly aumState: CatalogMetricState;
  readonly availableLiquidityUsd: string | null;
  readonly category: CatalogRecord["category"];
  readonly chainId: string;
  readonly comparativeRiskAdjustedApy: string | null;
  readonly databaseRouteId: string;
  readonly eligibility: Readonly<{
    investorClassifications: readonly (
      "RETAIL" | "ACCREDITED" | "QUALIFIED" | "PROFESSIONAL" | "INSTITUTIONAL"
    )[];
    jurisdictions: readonly string[];
    status: "ELIGIBLE" | "INELIGIBLE" | "CONDITIONAL" | "UNKNOWN";
  }>;
  readonly grossApy: string | null;
  readonly incentiveApy: string | null;
  readonly issuerId: string;
  readonly kyc: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";
  readonly lifecycle: "PUBLISHED" | "PAUSED" | "CLOSED" | "UNAVAILABLE";
  readonly liquidityAmounts: Readonly<{
    immediate: string | null;
    within24Hours: string | null;
    within7Days: string | null;
  }>;
  readonly liquidityState: CatalogMetricState;
  readonly methodologyVersion: string | null;
  readonly metricObservationIds: Readonly<{
    aumTvl: readonly string[];
    liquidity: readonly string[];
    risk: readonly string[];
    yield: readonly string[];
  }>;
  readonly netApy: string | null;
  readonly productId: string;
  readonly protocolId: string | null;
  readonly riskScore: string | null;
  readonly riskState: CatalogMetricState;
  readonly routeSlug: string;
  readonly sourceObservationIds: readonly string[];
  readonly stablecoinId: string | null;
  readonly underlyingAssetId: string;
  readonly yieldSourceClasses: readonly CatalogRecord["yieldSource"][];
  readonly yieldState: CatalogMetricState;
}

export interface EffectivePublicReadModel {
  readonly catalog: readonly CatalogRecord[];
  readonly databaseState: "ABSENT" | "HEALTHY" | "UNAVAILABLE";
  readonly methodology: EffectiveMethodology | null;
  readonly persistedEvidenceBySlug: ReadonlyMap<string, PersistedRouteEvidence>;
}

interface CachedReadModel {
  readonly expiresAt: number;
  readonly value: EffectivePublicReadModel;
}

let readModelCache: CachedReadModel | undefined;

const staticMethodology: EffectiveMethodology = {
  calculationVersion: "risk-engine-v1.0.0",
  description: "Published category-weighted comparative risk methodology v1.",
  methodology: RISK_METHODOLOGY_V1,
  source: "STATIC_FALLBACK"
};

const unavailableMetricState = (confidence: string): CatalogMetricState => ({
  confidence,
  observedAt: null,
  status: "UNAVAILABLE"
});

const isPublishedSource = (source: PublicSourceEvidence, now: Date): boolean => {
  if (
    source.publicationStatus !== "PUBLISHED" ||
    source.archivedAt !== null ||
    source.publishedAt === null ||
    (source.sourceStatus !== "ACTIVE" && source.sourceStatus !== "DEGRADED") ||
    source.verifiedAt > now
  ) {
    return false;
  }
  try {
    return new URL(source.url).protocol === "https:";
  } catch {
    return false;
  }
};

const sourceReference = (source: PublicSourceEvidence): CatalogRecord["source"] => ({
  name: source.name,
  type: source.type,
  url: source.url
});

const latestBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T> => {
  const selected = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (!selected.has(id)) selected.set(id, row);
  }
  return selected;
};

const displayLifecycle = (
  lifecycle: "ACTIVE" | "PAUSED" | "RESTRICTED" | "CLOSED" | "UNAVAILABLE" | "ARCHIVED"
): CatalogRecord["lifecycleStatus"] => lifecycle;

const optimizerLifecycle = (
  lifecycle: CatalogRecord["lifecycleStatus"]
): PersistedRouteEvidence["lifecycle"] => {
  switch (lifecycle) {
    case "ACTIVE":
      return "PUBLISHED";
    case "PAUSED":
      return "PAUSED";
    case "CLOSED":
      return "CLOSED";
    case "ARCHIVED":
    case "RESTRICTED":
    case "UNAVAILABLE":
      return "UNAVAILABLE";
  }
};

const routeIdentifier = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "") || "unavailable";

const metricWarning = (label: string, state: CatalogMetricState): string | null => {
  if (state.status === "CURRENT") return null;
  if (state.status === "STALE")
    return `${label} is the last persisted value and is stale under its source freshness policy.`;
  if (metricStateHasDisplayValue(state))
    return `${label} is ${state.status.toLocaleLowerCase("en-US")} and is labelled accordingly.`;
  return `${label} is ${state.status.toLocaleLowerCase("en-US").replaceAll("_", " ")}.`;
};

const latestTimestamp = (states: readonly CatalogMetricState[]): string | null =>
  states
    .flatMap((state) => (state.observedAt === null ? [] : [state.observedAt]))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

async function loadDatabaseMethodology(now: Date): Promise<EffectiveMethodology | null> {
  const database = getDatabase({ connectTimeoutSeconds: 3 });
  const [row] = await database
    .select()
    .from(riskMethodologyVersions)
    .where(
      and(
        eq(riskMethodologyVersions.publicationStatus, "PUBLISHED"),
        lte(riskMethodologyVersions.effectiveFrom, now),
        or(
          isNull(riskMethodologyVersions.effectiveTo),
          gt(riskMethodologyVersions.effectiveTo, now)
        )
      )
    )
    .orderBy(desc(riskMethodologyVersions.effectiveFrom))
    .limit(1);
  if (row === undefined) return null;
  const weights = await database
    .select({
      category: productCategories.code,
      factorCode: riskMethodologyCategoryWeights.factorCode,
      weight: riskMethodologyCategoryWeights.weight
    })
    .from(riskMethodologyCategoryWeights)
    .innerJoin(
      productCategories,
      eq(riskMethodologyCategoryWeights.categoryId, productCategories.id)
    )
    .where(eq(riskMethodologyCategoryWeights.methodologyVersionId, row.id));
  return buildDatabaseMethodology(row, weights);
}

async function loadDatabasePublicReadModel(now: Date): Promise<EffectivePublicReadModel> {
  const database = getDatabase({ connectTimeoutSeconds: 3 });
  const methodology = await loadDatabaseMethodology(now).catch(() => null);
  const routeRows = await database
    .select({
      accessMethod: productRoutes.accessMethod,
      category: productCategories.code,
      chain: chains.name,
      chainCaip2: chains.caip2Id,
      issuer: issuers.name,
      lifecycleStatus: productRoutes.lifecycleStatus,
      primaryAssetId: products.primaryAssetId,
      productArchivedAt: products.archivedAt,
      productEffectiveTo: products.effectiveTo,
      productId: products.id,
      productName: products.name,
      productPublicationStatus: products.publicationStatus,
      productPublishedAt: products.publishedAt,
      productSlug: products.slug,
      productVerifiedAt: products.verifiedAt,
      protocol: protocols.name,
      protocolId: protocols.id,
      requiresKyc: productRoutes.requiresKyc,
      routeArchivedAt: productRoutes.archivedAt,
      routeEffectiveTo: productRoutes.effectiveTo,
      routeId: productRoutes.id,
      routeName: productRoutes.name,
      routePublicationStatus: productRoutes.publicationStatus,
      routePublishedAt: productRoutes.publishedAt,
      routeSlug: productRoutes.slug,
      routeVerifiedAt: productRoutes.verifiedAt,
      routeVersion: productRoutes.version,
      symbol: products.symbol
    })
    .from(productRoutes)
    .innerJoin(products, eq(productRoutes.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(issuers, eq(products.issuerId, issuers.id))
    .leftJoin(protocols, eq(productRoutes.protocolId, protocols.id))
    .leftJoin(chains, eq(productRoutes.chainId, chains.id))
    .orderBy(desc(productRoutes.version), desc(productRoutes.updatedAt))
    .limit(MAX_CATALOG_VERSIONS);

  const latestRoutes = latestBy(routeRows, (row) => row.routeSlug);
  const controlledSlugs = new Set(latestRoutes.keys());
  const possiblePublicRows = [...latestRoutes.values()].filter(
    (row) =>
      row.routeEffectiveTo === null &&
      row.productEffectiveTo === null &&
      row.routeArchivedAt === null &&
      row.productArchivedAt === null &&
      row.routePublicationStatus === "PUBLISHED" &&
      row.productPublicationStatus === "PUBLISHED" &&
      row.routePublishedAt !== null &&
      row.productPublishedAt !== null &&
      row.routeVerifiedAt !== null &&
      row.productVerifiedAt !== null &&
      row.lifecycleStatus !== "ARCHIVED"
  );
  const routeIds = possiblePublicRows.map((row) => row.routeId);
  if (routeIds.length === 0) {
    return {
      catalog: mergeCatalogPublication(getCatalog(), [], controlledSlugs),
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map()
    };
  }

  const [importSources, auditSources, yieldSourceRows, eligibilityRows, redemptionRows] =
    await Promise.all([
      database
        .select({
          accessMethodDescription: catalogImportRecords.accessMethodDescription,
          archivedAt: sourceRegistry.archivedAt,
          chainLabel: catalogImportRecords.chainLabel,
          confidence: catalogImportRecords.confidence,
          eligibilitySummary: catalogImportRecords.eligibilitySummary,
          importCreatedAt: catalogImportRecords.createdAt,
          importPublicationStatus: catalogImportRecords.publicationStatus,
          name: sourceRegistry.name,
          publishedAt: sourceRegistry.publishedAt,
          publicationStatus: sourceRegistry.publicationStatus,
          redemptionSummary: catalogImportRecords.redemptionSummary,
          routeId: catalogImportRecords.routeId,
          sourceId: sourceRegistry.id,
          sourceStatus: sourceRegistry.status,
          type: sourceRegistry.sourceType,
          underlyingAsset: catalogImportRecords.underlyingAsset,
          url: sourceRegistry.canonicalUrl,
          verifiedAt: catalogImportRecords.verifiedAt,
          warnings: catalogImportRecords.warnings
        })
        .from(catalogImportRecords)
        .innerJoin(sourceRegistry, eq(catalogImportRecords.sourceId, sourceRegistry.id))
        .where(inArray(catalogImportRecords.routeId, routeIds))
        .orderBy(desc(catalogImportRecords.createdAt)),
      database
        .select({
          archivedAt: sourceRegistry.archivedAt,
          confidence: catalogImportRecords.confidence,
          name: sourceRegistry.name,
          occurredAt: adminAuditLogs.occurredAt,
          publishedAt: sourceRegistry.publishedAt,
          publicationStatus: sourceRegistry.publicationStatus,
          routeId: adminAuditLogs.targetId,
          sourceId: sourceRegistry.id,
          sourceStatus: sourceRegistry.status,
          type: sourceRegistry.sourceType,
          url: sourceRegistry.canonicalUrl,
          verificationDate: adminAuditLogs.verificationDate
        })
        .from(adminAuditLogs)
        .innerJoin(sourceRegistry, eq(adminAuditLogs.sourceId, sourceRegistry.id))
        .leftJoin(catalogImportRecords, eq(catalogImportRecords.routeId, adminAuditLogs.targetId))
        .where(
          and(
            inArray(adminAuditLogs.targetId, routeIds),
            eq(adminAuditLogs.targetType, "PRODUCT_ROUTE"),
            eq(adminAuditLogs.action, "CATALOG_PUBLISH"),
            eq(adminAuditLogs.outcome, "APPROVED")
          )
        )
        .orderBy(desc(adminAuditLogs.occurredAt)),
      database
        .select({
          effectiveFrom: productYieldSources.effectiveFrom,
          routeId: productYieldSources.routeId,
          sourceClass: yieldSources.sourceClass
        })
        .from(productYieldSources)
        .innerJoin(yieldSources, eq(productYieldSources.yieldSourceId, yieldSources.id))
        .where(
          and(
            inArray(productYieldSources.routeId, routeIds),
            isNull(productYieldSources.effectiveTo)
          )
        )
        .orderBy(desc(productYieldSources.effectiveFrom)),
      database
        .select({
          conditionsText: eligibilityRules.conditionsText,
          eligibilityStatus: eligibilityRules.eligibilityStatus,
          investorClassification: eligibilityRules.investorClassification,
          isoCode: jurisdictions.isoCode,
          publicationStatus: eligibilityRules.publicationStatus,
          requiresKyc: eligibilityRules.requiresKyc,
          routeId: eligibilityRules.routeId,
          sourceArchivedAt: sourceRegistry.archivedAt,
          sourcePublishedAt: sourceRegistry.publishedAt,
          sourcePublicationStatus: sourceRegistry.publicationStatus,
          sourceStatus: sourceRegistry.status,
          sourceUrl: sourceRegistry.canonicalUrl,
          verifiedAt: eligibilityRules.verifiedAt
        })
        .from(eligibilityRules)
        .innerJoin(jurisdictions, eq(eligibilityRules.jurisdictionId, jurisdictions.id))
        .innerJoin(
          sourceObservations,
          eq(eligibilityRules.sourceObservationId, sourceObservations.id)
        )
        .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
        .where(
          and(
            inArray(eligibilityRules.routeId, routeIds),
            isNull(eligibilityRules.effectiveTo),
            eq(eligibilityRules.publicationStatus, "PUBLISHED")
          )
        )
        .orderBy(desc(eligibilityRules.effectiveFrom)),
      database
        .select({
          gatesPossible: redemptionTerms.gatesPossible,
          inKindPossible: redemptionTerms.inKindPossible,
          minimumAmount: redemptionTerms.minimumAmount,
          noticePeriodHours: redemptionTerms.noticePeriodHours,
          publicationStatus: redemptionTerms.publicationStatus,
          routeId: redemptionTerms.routeId,
          settlementPeriodHours: redemptionTerms.settlementPeriodHours,
          sourceArchivedAt: sourceRegistry.archivedAt,
          sourcePublishedAt: sourceRegistry.publishedAt,
          sourcePublicationStatus: sourceRegistry.publicationStatus,
          sourceStatus: sourceRegistry.status,
          sourceUrl: sourceRegistry.canonicalUrl,
          verifiedAt: redemptionTerms.verifiedAt,
          windowDescription: redemptionTerms.windowDescription
        })
        .from(redemptionTerms)
        .innerJoin(
          sourceObservations,
          eq(redemptionTerms.sourceObservationId, sourceObservations.id)
        )
        .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
        .where(
          and(
            inArray(redemptionTerms.routeId, routeIds),
            isNull(redemptionTerms.effectiveTo),
            eq(redemptionTerms.publicationStatus, "PUBLISHED")
          )
        )
        .orderBy(desc(redemptionTerms.effectiveFrom))
    ]);

  const importedByRoute = latestBy(importSources, (row) => row.routeId);
  const auditedByRoute = latestBy(auditSources, (row) => row.routeId);

  const provenanceByRoute = new Map<string, PublicSourceEvidence>();
  for (const row of possiblePublicRows) {
    const audited = auditedByRoute.get(row.routeId);
    const imported = importedByRoute.get(row.routeId);
    const source: PublicSourceEvidence | null =
      audited?.verificationDate !== null && audited?.verificationDate !== undefined
        ? {
            archivedAt: audited.archivedAt,
            confidence: audited.confidence ?? "MANUALLY_VERIFIED",
            name: audited.name,
            publishedAt: audited.publishedAt,
            publicationStatus: audited.publicationStatus,
            sourceId: audited.sourceId,
            sourceStatus: audited.sourceStatus,
            type: audited.type,
            url: audited.url,
            verifiedAt: audited.verificationDate
          }
        : imported?.importPublicationStatus === "PUBLISHED"
          ? {
              archivedAt: imported.archivedAt,
              confidence: imported.confidence,
              name: imported.name,
              publishedAt: imported.publishedAt,
              publicationStatus: imported.publicationStatus,
              sourceId: imported.sourceId,
              sourceStatus: imported.sourceStatus,
              type: imported.type,
              url: imported.url,
              verifiedAt: imported.verifiedAt
            }
          : null;
    if (source !== null && isPublishedSource(source, now))
      provenanceByRoute.set(row.routeId, source);
  }

  const admittedRows = possiblePublicRows.filter((row) => provenanceByRoute.has(row.routeId));
  const admittedIds = admittedRows.map((row) => row.routeId);
  if (admittedIds.length === 0) {
    return {
      catalog: mergeCatalogPublication(getCatalog(), [], controlledSlugs),
      databaseState: "HEALTHY",
      methodology,
      persistedEvidenceBySlug: new Map()
    };
  }

  const [yieldRows, aumRows, liquidityRows, riskRows] = await Promise.all([
    database
      .selectDistinctOn([yieldSnapshots.routeId], {
        comparativeRiskAdjustedApy: yieldSnapshots.comparativeRiskAdjustedApy,
        confidence: yieldSnapshots.confidence,
        freshnessThresholdSeconds: sourceRegistry.freshnessThresholdSeconds,
        grossApy: yieldSnapshots.grossApy,
        incentiveApy: yieldSnapshots.incentiveApy,
        netApy: yieldSnapshots.netApy,
        observedAt: yieldSnapshots.asOf,
        routeId: yieldSnapshots.routeId,
        sourceId: sourceRegistry.id,
        sourceName: sourceRegistry.name,
        sourceObservationId: yieldSnapshots.sourceObservationId,
        sourcePublishedAt: sourceRegistry.publishedAt,
        sourcePublicationStatus: sourceRegistry.publicationStatus,
        sourceStatus: sourceRegistry.status,
        sourceType: sourceRegistry.sourceType,
        sourceUrl: sourceRegistry.canonicalUrl,
        status: yieldSnapshots.status
      })
      .from(yieldSnapshots)
      .innerJoin(sourceObservations, eq(yieldSnapshots.sourceObservationId, sourceObservations.id))
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(
        and(
          inArray(yieldSnapshots.routeId, admittedIds),
          isNull(sourceRegistry.archivedAt),
          eq(sourceRegistry.publicationStatus, "PUBLISHED"),
          lte(sourceRegistry.publishedAt, now),
          inArray(sourceRegistry.status, ["ACTIVE", "DEGRADED"])
        )
      )
      .orderBy(yieldSnapshots.routeId, desc(yieldSnapshots.asOf)),
    database
      .selectDistinctOn([tvlAumSnapshots.routeId], {
        amount: tvlAumSnapshots.amount,
        confidence: tvlAumSnapshots.confidence,
        freshnessThresholdSeconds: sourceRegistry.freshnessThresholdSeconds,
        observedAt: tvlAumSnapshots.asOf,
        routeId: tvlAumSnapshots.routeId,
        sourceObservationId: tvlAumSnapshots.sourceObservationId,
        sourceStatus: sourceRegistry.status,
        status: tvlAumSnapshots.status
      })
      .from(tvlAumSnapshots)
      .innerJoin(sourceObservations, eq(tvlAumSnapshots.sourceObservationId, sourceObservations.id))
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(
        and(
          inArray(tvlAumSnapshots.routeId, admittedIds),
          isNull(sourceRegistry.archivedAt),
          eq(sourceRegistry.publicationStatus, "PUBLISHED"),
          lte(sourceRegistry.publishedAt, now),
          inArray(sourceRegistry.status, ["ACTIVE", "DEGRADED"])
        )
      )
      .orderBy(tvlAumSnapshots.routeId, desc(tvlAumSnapshots.asOf)),
    database
      .selectDistinctOn([liquiditySnapshots.routeId], {
        availableWithin24h: liquiditySnapshots.availableWithin24h,
        availableWithin7d: liquiditySnapshots.availableWithin7d,
        confidence: liquiditySnapshots.confidence,
        freshnessThresholdSeconds: sourceRegistry.freshnessThresholdSeconds,
        immediatelyAvailable: liquiditySnapshots.immediatelyAvailable,
        observedAt: liquiditySnapshots.asOf,
        routeId: liquiditySnapshots.routeId,
        sourceObservationId: liquiditySnapshots.sourceObservationId,
        sourceStatus: sourceRegistry.status,
        status: liquiditySnapshots.status
      })
      .from(liquiditySnapshots)
      .innerJoin(
        sourceObservations,
        eq(liquiditySnapshots.sourceObservationId, sourceObservations.id)
      )
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(
        and(
          inArray(liquiditySnapshots.routeId, admittedIds),
          isNull(sourceRegistry.archivedAt),
          eq(sourceRegistry.publicationStatus, "PUBLISHED"),
          lte(sourceRegistry.publishedAt, now),
          inArray(sourceRegistry.status, ["ACTIVE", "DEGRADED"])
        )
      )
      .orderBy(liquiditySnapshots.routeId, desc(liquiditySnapshots.asOf)),
    methodology === null
      ? Promise.resolve([])
      : database
          .selectDistinctOn([compositeRiskSnapshots.routeId], {
            calculatedAt: compositeRiskSnapshots.calculatedAt,
            calculationInputs: compositeRiskSnapshots.calculationInputs,
            compositeScore: compositeRiskSnapshots.compositeScore,
            confidence: compositeRiskSnapshots.confidence,
            methodologyVersionId: compositeRiskSnapshots.methodologyVersionId,
            resultStatus: compositeRiskSnapshots.resultStatus,
            routeId: compositeRiskSnapshots.routeId,
            totalComparativeApyPenalty: compositeRiskSnapshots.totalComparativeApyPenalty
          })
          .from(compositeRiskSnapshots)
          .where(
            and(
              inArray(compositeRiskSnapshots.routeId, admittedIds),
              eq(compositeRiskSnapshots.methodologyVersionId, methodology.methodology.id)
            )
          )
          .orderBy(compositeRiskSnapshots.routeId, desc(compositeRiskSnapshots.calculatedAt))
  ]);

  const yieldByRoute = latestBy(yieldRows, (row) => row.routeId ?? "");
  const aumByRoute = latestBy(aumRows, (row) => row.routeId ?? "");
  const liquidityByRoute = latestBy(liquidityRows, (row) => row.routeId ?? "");
  const riskByRoute = latestBy(riskRows, (row) => row.routeId ?? "");
  const riskInputsByRoute = new Map<
    string,
    NonNullable<ReturnType<typeof parseCompositeRiskEvidenceInput>>
  >();
  for (const row of riskRows) {
    if (row.routeId === null) continue;
    const parsedInputs = parseCompositeRiskEvidenceInput(
      row.calculationInputs,
      row.calculatedAt,
      row.methodologyVersionId
    );
    if (parsedInputs !== null) riskInputsByRoute.set(row.routeId, parsedInputs);
  }
  const allRiskFactorSnapshotIds = [
    ...new Set([...riskInputsByRoute.values()].flatMap((input) => input.factorSnapshotIds))
  ];
  const riskEvidenceRows =
    allRiskFactorSnapshotIds.length === 0
      ? []
      : await database
          .select({
            factorSnapshotId: riskFactorEvidence.riskFactorSnapshotId,
            observedAt: sourceObservations.observedAt,
            sourceObservationId: riskFactorEvidence.sourceObservationId,
            sourcePublicationStatus: sourceRegistry.publicationStatus,
            sourcePublishedAt: sourceRegistry.publishedAt,
            sourceStatus: sourceRegistry.status
          })
          .from(riskFactorEvidence)
          .innerJoin(
            sourceObservations,
            eq(riskFactorEvidence.sourceObservationId, sourceObservations.id)
          )
          .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
          .where(
            and(
              inArray(riskFactorEvidence.riskFactorSnapshotId, allRiskFactorSnapshotIds),
              eq(sourceObservations.status, "AVAILABLE"),
              isNull(sourceRegistry.archivedAt),
              eq(sourceRegistry.publicationStatus, "PUBLISHED"),
              lte(sourceRegistry.publishedAt, now),
              inArray(sourceRegistry.status, ["ACTIVE", "DEGRADED"])
            )
          );
  const riskFactorRows =
    allRiskFactorSnapshotIds.length === 0
      ? []
      : await database
          .select({
            calculatedAt: riskFactorSnapshots.calculatedAt,
            factorCode: riskFactorSnapshots.factorCode,
            id: riskFactorSnapshots.id,
            methodologyVersionId: riskFactorSnapshots.methodologyVersionId,
            routeId: riskFactorSnapshots.routeId
          })
          .from(riskFactorSnapshots)
          .where(inArray(riskFactorSnapshots.id, allRiskFactorSnapshotIds));
  const riskObservationIdsByRoute = new Map<string, string[]>();
  for (const [routeId, input] of riskInputsByRoute) {
    const observedIds = validateCompositeRiskObservationIds({
      composite: input,
      evidence: riskEvidenceRows,
      factors: riskFactorRows,
      now,
      routeId
    });
    if (observedIds.length > 0) riskObservationIdsByRoute.set(routeId, observedIds);
  }
  const yieldSourcesByRoute = new Map<string, string[]>();
  for (const row of yieldSourceRows) {
    if (row.routeId === null) continue;
    const values = yieldSourcesByRoute.get(row.routeId) ?? [];
    if (!values.includes(row.sourceClass)) values.push(row.sourceClass);
    yieldSourcesByRoute.set(row.routeId, values);
  }

  const fallbackBySlug = new Map(getCatalog(true).map((record) => [record.slug, record]));
  const databaseRecords: CatalogRecord[] = [];
  const evidenceBySlug = new Map<string, PersistedRouteEvidence>();

  for (const row of admittedRows) {
    const provenance = provenanceByRoute.get(row.routeId);
    if (provenance === undefined || row.routeVerifiedAt === null || row.productVerifiedAt === null)
      continue;
    const imported = importedByRoute.get(row.routeId);
    const fallback = fallbackBySlug.get(row.routeSlug);
    const yieldRow = yieldByRoute.get(row.routeId);
    const aumRow = aumByRoute.get(row.routeId);
    const liquidityRow = liquidityByRoute.get(row.routeId);
    const riskRow = riskByRoute.get(row.routeId);
    const riskObservationIds = riskObservationIdsByRoute.get(row.routeId) ?? [];

    const yieldState =
      yieldRow === undefined
        ? unavailableMetricState(provenance.confidence)
        : resolveMetricState(
            {
              confidence: yieldRow.confidence,
              freshnessThresholdSeconds:
                yieldRow.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_SECONDS.yield,
              hasValue:
                yieldRow.grossApy !== null ||
                yieldRow.netApy !== null ||
                yieldRow.comparativeRiskAdjustedApy !== null,
              observedAt: yieldRow.observedAt,
              sourceStatus: yieldRow.sourceStatus,
              status: yieldRow.status
            },
            now
          );
    const aumState =
      aumRow === undefined
        ? unavailableMetricState(provenance.confidence)
        : resolveMetricState(
            {
              confidence: aumRow.confidence,
              freshnessThresholdSeconds:
                aumRow.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_SECONDS.aumTvl,
              hasValue: aumRow.amount !== null,
              observedAt: aumRow.observedAt,
              sourceStatus: aumRow.sourceStatus,
              status: aumRow.status
            },
            now
          );
    const liquidityState =
      liquidityRow === undefined
        ? unavailableMetricState(provenance.confidence)
        : resolveMetricState(
            {
              confidence: liquidityRow.confidence,
              freshnessThresholdSeconds:
                liquidityRow.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_SECONDS.liquidity,
              hasValue:
                liquidityRow.immediatelyAvailable !== null ||
                liquidityRow.availableWithin24h !== null ||
                liquidityRow.availableWithin7d !== null,
              observedAt: liquidityRow.observedAt,
              sourceStatus: liquidityRow.sourceStatus,
              status: liquidityRow.status
            },
            now
          );
    const riskState =
      riskRow === undefined || riskObservationIds.length === 0
        ? unavailableMetricState(provenance.confidence)
        : resolveMetricState(
            {
              confidence: riskRow.confidence,
              freshnessThresholdSeconds: DEFAULT_FRESHNESS_SECONDS.risk,
              hasValue: riskRow.compositeScore !== null,
              observedAt: riskRow.calculatedAt,
              sourceStatus: "ACTIVE",
              status: riskRow.resultStatus === "AVAILABLE" ? "AVAILABLE" : "ESTIMATED"
            },
            now
          );

    const publishedEligibility = eligibilityRows.filter(
      (candidate) =>
        candidate.routeId === row.routeId &&
        candidate.verifiedAt !== null &&
        candidate.verifiedAt <= now &&
        candidate.sourceArchivedAt === null &&
        candidate.sourcePublicationStatus === "PUBLISHED" &&
        candidate.sourcePublishedAt !== null &&
        (candidate.sourceStatus === "ACTIVE" || candidate.sourceStatus === "DEGRADED") &&
        candidate.sourceUrl.startsWith("https://")
    );
    const investorClassifications = publishedEligibility.flatMap((candidate) =>
      candidate.investorClassification === "UNKNOWN" ? [] : [candidate.investorClassification]
    );
    const eligibilityStatus: PersistedRouteEvidence["eligibility"]["status"] =
      publishedEligibility.length === 0
        ? "UNKNOWN"
        : publishedEligibility.some((candidate) => candidate.eligibilityStatus === "INELIGIBLE")
          ? "CONDITIONAL"
          : publishedEligibility.every((candidate) => candidate.eligibilityStatus === "ELIGIBLE")
            ? "CONDITIONAL"
            : publishedEligibility.some(
                  (candidate) => candidate.eligibilityStatus === "CONDITIONAL"
                )
              ? "CONDITIONAL"
              : "UNKNOWN";
    const eligibilitySummary =
      publishedEligibility.length === 0
        ? (imported?.eligibilitySummary ?? "Eligibility evidence is unavailable.")
        : publishedEligibility
            .map(
              (candidate) =>
                `${candidate.isoCode} ${candidate.investorClassification}: ${candidate.eligibilityStatus}${candidate.conditionsText ? ` — ${candidate.conditionsText}` : ""}`
            )
            .join("; ");

    const publishedRedemption = redemptionRows.find(
      (candidate) =>
        candidate.routeId === row.routeId &&
        candidate.verifiedAt !== null &&
        candidate.verifiedAt <= now &&
        candidate.sourceArchivedAt === null &&
        candidate.sourcePublicationStatus === "PUBLISHED" &&
        candidate.sourcePublishedAt !== null &&
        (candidate.sourceStatus === "ACTIVE" || candidate.sourceStatus === "DEGRADED") &&
        candidate.sourceUrl.startsWith("https://")
    );
    const redemptionSummary =
      publishedRedemption === undefined
        ? (imported?.redemptionSummary ?? "Redemption terms are unavailable.")
        : [
            publishedRedemption.windowDescription,
            publishedRedemption.noticePeriodHours === null
              ? null
              : `${publishedRedemption.noticePeriodHours}h notice`,
            publishedRedemption.settlementPeriodHours === null
              ? null
              : `${publishedRedemption.settlementPeriodHours}h settlement`,
            publishedRedemption.gatesPossible === true ? "gates may apply" : null,
            publishedRedemption.inKindPossible === true ? "in-kind redemption may apply" : null
          ]
            .filter((value): value is string => value !== null && value.length > 0)
            .join("; ") || "Published redemption terms contain no timing claim.";

    const source =
      yieldRow !== undefined &&
      yieldRow.sourcePublicationStatus === "PUBLISHED" &&
      yieldRow.sourcePublishedAt !== null
        ? {
            name: yieldRow.sourceName,
            type: yieldRow.sourceType,
            url: yieldRow.sourceUrl
          }
        : sourceReference(provenance);
    const identitySource = sourceReference(provenance);
    const states = [yieldState, aumState, liquidityState, riskState] as const;
    const metricObservationIds = {
      aumTvl: aumRow === undefined ? [] : [aumRow.sourceObservationId],
      liquidity: liquidityRow === undefined ? [] : [liquidityRow.sourceObservationId],
      risk: riskObservationIds,
      yield: yieldRow === undefined ? [] : [yieldRow.sourceObservationId]
    } as const;
    const sourceObservationIds = [
      ...new Set([
        ...metricObservationIds.yield,
        ...metricObservationIds.aumTvl,
        ...metricObservationIds.liquidity,
        ...metricObservationIds.risk
      ])
    ].sort();
    const yieldSourceClasses = yieldSourcesByRoute.get(row.routeId) ?? [
      fallback?.yieldSource ?? "OTHER_VERIFIED"
    ];
    const hasPersistedMetricEvidence = states.some((state) => state.observedAt !== null);
    const warnings = [
      ...(fallback?.warnings ?? []).filter(
        (warning) =>
          !hasPersistedMetricEvidence ||
          warning !==
            "Identity metadata is sourced; live financial metrics remain unavailable until fresh observations pass admission."
      ),
      ...states.flatMap((state, index) => {
        const label = ["Yield", "AUM/TVL", "Liquidity", "Risk"][index] ?? "Metric";
        const warning = metricWarning(label, state);
        return warning === null ? [] : [warning];
      })
    ];
    if (methodology === null)
      warnings.push("No complete currently effective published database methodology is available.");

    const netApy = metricStateHasDisplayValue(yieldState) ? (yieldRow?.netApy ?? null) : null;
    const riskAdjustedApy =
      netApy !== null &&
      riskRow?.totalComparativeApyPenalty !== null &&
      riskRow?.totalComparativeApyPenalty !== undefined &&
      metricStateHasDisplayValue(riskState)
        ? new Decimal(netApy).minus(riskRow.totalComparativeApyPenalty).toString()
        : null;
    const record: CatalogRecord = {
      accessMethod: imported?.accessMethodDescription ?? row.accessMethod.replaceAll("_", " "),
      aumTvlUsd: metricStateHasDisplayValue(aumState) ? (aumRow?.amount ?? null) : null,
      category: row.category,
      chain: row.chain ?? imported?.chainLabel ?? "Off-chain / issuer venue",
      confidence: yieldState.observedAt === null ? provenance.confidence : yieldState.confidence,
      eligibilitySummary,
      grossApy: metricStateHasDisplayValue(yieldState) ? (yieldRow?.grossApy ?? null) : null,
      id: row.routeId,
      identitySource,
      issuer: row.issuer ?? "Issuer unavailable",
      kycRequired: row.requiresKyc,
      lifecycleStatus: displayLifecycle(row.lifecycleStatus),
      liquidityUsd: metricStateHasDisplayValue(liquidityState)
        ? (liquidityRow?.immediatelyAvailable ?? null)
        : null,
      methodologyVersion: methodology?.methodology.semanticVersion ?? null,
      metricStatus: {
        aumTvl: aumState,
        liquidity: liquidityState,
        risk: riskState,
        yield: yieldState
      },
      nativeYield:
        yieldSourceClasses.includes("NO_NATIVE_YIELD") && row.accessMethod === "NATIVE_HOLD"
          ? "0"
          : (fallback?.nativeYield ?? null),
      netApy,
      observedAt: latestTimestamp(states),
      productName: row.productName,
      productSlug: row.productSlug,
      protocol: row.protocol,
      publicationStatus: "PUBLISHED",
      redemptionSummary,
      riskAdjustedApy,
      riskScore: metricStateHasDisplayValue(riskState) ? (riskRow?.compositeScore ?? null) : null,
      routeName: row.routeName,
      slug: row.routeSlug,
      source,
      sourceObservationIds,
      status: row.lifecycleStatus,
      symbol: row.symbol,
      underlyingAsset: imported?.underlyingAsset ?? row.symbol,
      verifiedAt: new Date(
        Math.max(
          row.routeVerifiedAt.getTime(),
          row.productVerifiedAt.getTime(),
          provenance.verifiedAt.getTime()
        )
      ).toISOString(),
      warnings: [...new Set(warnings)],
      yieldSource: yieldSourceClasses[0] ?? "OTHER_VERIFIED"
    };
    databaseRecords.push(record);
    evidenceBySlug.set(row.routeSlug, {
      aumOrTvlUsd: record.aumTvlUsd,
      aumState,
      availableLiquidityUsd: record.liquidityUsd,
      category: record.category,
      chainId: row.chainCaip2 ?? routeIdentifier(record.chain),
      comparativeRiskAdjustedApy: record.riskAdjustedApy,
      databaseRouteId: row.routeId,
      eligibility: {
        investorClassifications: [...new Set(investorClassifications)],
        jurisdictions: [...new Set(publishedEligibility.map((candidate) => candidate.isoCode))],
        status: eligibilityStatus
      },
      grossApy: record.grossApy,
      incentiveApy: metricStateHasDisplayValue(yieldState)
        ? (yieldRow?.incentiveApy ?? null)
        : null,
      issuerId: routeIdentifier(record.issuer),
      kyc: row.requiresKyc === null ? "UNKNOWN" : row.requiresKyc ? "REQUIRED" : "NOT_REQUIRED",
      lifecycle: optimizerLifecycle(record.lifecycleStatus),
      liquidityAmounts: {
        immediate: record.liquidityUsd,
        within24Hours: metricStateHasDisplayValue(liquidityState)
          ? (liquidityRow?.availableWithin24h ?? null)
          : null,
        within7Days: metricStateHasDisplayValue(liquidityState)
          ? (liquidityRow?.availableWithin7d ?? null)
          : null
      },
      liquidityState,
      methodologyVersion: record.methodologyVersion,
      metricObservationIds,
      netApy: record.netApy,
      productId: row.productId,
      protocolId: row.protocolId,
      riskScore: record.riskScore,
      riskState,
      routeSlug: row.routeSlug,
      sourceObservationIds,
      stablecoinId: record.underlyingAsset.toUpperCase().includes("USD")
        ? routeIdentifier(record.underlyingAsset)
        : null,
      underlyingAssetId: row.primaryAssetId,
      yieldSourceClasses,
      yieldState
    });
  }

  return {
    catalog: mergeCatalogPublication(getCatalog(), databaseRecords, controlledSlugs),
    databaseState: "HEALTHY",
    methodology,
    persistedEvidenceBySlug: evidenceBySlug
  };
}

export async function getEffectivePublicReadModel(): Promise<EffectivePublicReadModel> {
  noStore();
  const nowMs = Date.now();
  if (readModelCache !== undefined && readModelCache.expiresAt > nowMs) return readModelCache.value;

  const config = getServerConfig();
  if (config.databaseUrl === undefined) {
    const value: EffectivePublicReadModel = {
      catalog: getCatalog(),
      databaseState: "ABSENT",
      methodology: staticMethodology,
      persistedEvidenceBySlug: new Map()
    };
    readModelCache = { expiresAt: nowMs + 15_000, value };
    return value;
  }

  try {
    const loaded = await loadDatabasePublicReadModel(new Date(nowMs));
    const value: EffectivePublicReadModel =
      loaded.methodology !== null || config.nodeEnv === "production"
        ? loaded
        : { ...loaded, methodology: staticMethodology };
    readModelCache = { expiresAt: nowMs + 15_000, value };
    return value;
  } catch {
    const value: EffectivePublicReadModel = {
      catalog: getCatalog().map((record) => ({
        ...record,
        warnings: [
          ...record.warnings,
          "The configured database is unavailable; this is bundled identity research, not current publication or metric evidence."
        ]
      })),
      databaseState: "UNAVAILABLE",
      methodology: config.nodeEnv === "production" ? null : staticMethodology,
      persistedEvidenceBySlug: new Map()
    };
    readModelCache = { expiresAt: nowMs + 5_000, value };
    return value;
  }
}

export async function getEffectiveMethodology(): Promise<EffectiveMethodology | null> {
  return (await getEffectivePublicReadModel()).methodology;
}

export function clearPublicReadModelCacheForTests(): void {
  readModelCache = undefined;
}

export type { RiskMethodology };

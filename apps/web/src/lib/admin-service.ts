import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  adapterHealth,
  adminAuditLogs,
  assets,
  catalogImportRecords,
  chains,
  custodians,
  dataQualityEvents,
  eligibilityRules,
  issuers,
  jobRuns,
  jurisdictions,
  notificationDeliveries,
  productCategories,
  products,
  productRoutes,
  protocols,
  redemptionTerms,
  riskMethodologyCategoryWeights,
  riskMethodologyVersions,
  securityAuditEvents,
  sourceObservations,
  sourceRegistry,
  type Database
} from "@rwa-yield-router/database";
import { RISK_FACTORS } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { CATEGORY_VALUES } from "@/lib/constants";
import type { AdminAction, AdminSnapshot } from "@/lib/admin-contract";

const ADMIN_ADAPTER_VERSION = "admin-curation-v1";
const MAX_ROWS = 250;

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const jsonText = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
};

const normalizedObservationValue = (row: {
  normalizedBooleanValue: boolean | null;
  normalizedJsonValue: unknown;
  normalizedNumericValue: string | null;
  normalizedTextValue: string | null;
}): string | null => {
  if (row.normalizedNumericValue !== null) return row.normalizedNumericValue;
  if (row.normalizedTextValue !== null) return row.normalizedTextValue;
  if (row.normalizedBooleanValue !== null) return String(row.normalizedBooleanValue);
  return row.normalizedJsonValue === null ? null : jsonText(row.normalizedJsonValue);
};

const deduplicateBy = <T>(rows: readonly T[], key: (row: T) => string): T[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = key(row);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

export async function getAdminSnapshot(database: Database): Promise<AdminSnapshot> {
  const [
    catalogRaw,
    sourcesRaw,
    jurisdictionRows,
    assetRows,
    issuerRows,
    protocolRows,
    chainRows,
    custodianRows,
    observationsRaw,
    qualityRows,
    healthRows,
    jobRows,
    deliveryRows,
    auditRows,
    methodologyRows,
    methodologyWeightRows,
    eligibilityRows,
    redemptionRows
  ] = await Promise.all([
    database
      .select({
        category: productCategories.code,
        chain: chains.name,
        discoveryStatus: catalogImportRecords.discoveryStatus,
        eligibilitySummary: catalogImportRecords.eligibilitySummary,
        issuer: issuers.name,
        lifecycleStatus: productRoutes.lifecycleStatus,
        productId: products.id,
        productName: products.name,
        protocol: protocols.name,
        publicationStatus: productRoutes.publicationStatus,
        redemptionSummary: catalogImportRecords.redemptionSummary,
        routeId: productRoutes.id,
        routeName: productRoutes.name,
        routeSlug: productRoutes.slug,
        routeVersion: productRoutes.version,
        sourceId: sourceRegistry.id,
        sourceName: sourceRegistry.name,
        sourceUrl: sourceRegistry.canonicalUrl,
        symbol: products.symbol,
        verifiedAt: productRoutes.verifiedAt,
        warnings: catalogImportRecords.warnings
      })
      .from(productRoutes)
      .innerJoin(products, eq(productRoutes.productId, products.id))
      .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(issuers, eq(products.issuerId, issuers.id))
      .leftJoin(protocols, eq(productRoutes.protocolId, protocols.id))
      .leftJoin(chains, eq(productRoutes.chainId, chains.id))
      .leftJoin(catalogImportRecords, eq(catalogImportRecords.routeId, productRoutes.id))
      .leftJoin(sourceRegistry, eq(catalogImportRecords.sourceId, sourceRegistry.id))
      .where(isNull(productRoutes.effectiveTo))
      .orderBy(desc(productRoutes.updatedAt), desc(catalogImportRecords.verifiedAt))
      .limit(MAX_ROWS),
    database.select().from(sourceRegistry).orderBy(desc(sourceRegistry.version)).limit(500),
    database.select().from(jurisdictions).orderBy(jurisdictions.isoCode).limit(MAX_ROWS),
    database
      .select({ id: assets.id, name: assets.name, symbol: assets.symbol })
      .from(assets)
      .orderBy(assets.symbol)
      .limit(MAX_ROWS),
    database.select().from(issuers).orderBy(issuers.name).limit(MAX_ROWS),
    database.select().from(protocols).orderBy(protocols.name).limit(MAX_ROWS),
    database.select().from(chains).orderBy(chains.name).limit(MAX_ROWS),
    database.select().from(custodians).orderBy(custodians.name).limit(MAX_ROWS),
    database
      .select({
        confidence: sourceObservations.confidence,
        entityId: sourceObservations.entityId,
        entityType: sourceObservations.entityType,
        id: sourceObservations.id,
        metric: sourceObservations.metric,
        normalizedBooleanValue: sourceObservations.normalizedBooleanValue,
        normalizedJsonValue: sourceObservations.normalizedJsonValue,
        normalizedNumericValue: sourceObservations.normalizedNumericValue,
        normalizedTextValue: sourceObservations.normalizedTextValue,
        observedAt: sourceObservations.observedAt,
        sourceId: sourceObservations.sourceId,
        sourceName: sourceRegistry.name,
        status: sourceObservations.status,
        unit: sourceObservations.unit
      })
      .from(sourceObservations)
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .orderBy(desc(sourceObservations.observedAt))
      .limit(150),
    database
      .select()
      .from(dataQualityEvents)
      .orderBy(desc(dataQualityEvents.detectedAt))
      .limit(150),
    database
      .select({
        adapterVersion: adapterHealth.adapterVersion,
        attemptedAt: adapterHealth.attemptedAt,
        deadLetterCount: adapterHealth.deadLetterCount,
        durationMs: adapterHealth.durationMs,
        errorCategory: adapterHealth.errorCategory,
        id: adapterHealth.id,
        outcome: adapterHealth.outcome,
        recordsAccepted: adapterHealth.recordsAccepted,
        recordsChanged: adapterHealth.recordsChanged,
        recordsRejected: adapterHealth.recordsRejected,
        retryCount: adapterHealth.retryCount,
        sourceName: sourceRegistry.name,
        staleRecordCount: adapterHealth.staleRecordCount
      })
      .from(adapterHealth)
      .innerJoin(sourceRegistry, eq(adapterHealth.sourceId, sourceRegistry.id))
      .orderBy(desc(adapterHealth.attemptedAt))
      .limit(100),
    database
      .select({
        attempt: jobRuns.attempt,
        completedAt: jobRuns.completedAt,
        correlationId: jobRuns.correlationId,
        deadLetterCount: jobRuns.deadLetterCount,
        errorCategory: jobRuns.errorCategory,
        id: jobRuns.id,
        jobName: jobRuns.jobName,
        queuedAt: jobRuns.queuedAt,
        sourceName: sourceRegistry.name,
        status: jobRuns.status
      })
      .from(jobRuns)
      .leftJoin(sourceRegistry, eq(jobRuns.sourceId, sourceRegistry.id))
      .orderBy(desc(jobRuns.queuedAt))
      .limit(100),
    database
      .select({
        attemptCount: notificationDeliveries.attemptCount,
        channel: notificationDeliveries.channel,
        createdAt: notificationDeliveries.createdAt,
        deliveredAt: notificationDeliveries.deliveredAt,
        errorCategory: notificationDeliveries.errorCategory,
        id: notificationDeliveries.id,
        status: notificationDeliveries.status
      })
      .from(notificationDeliveries)
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(100),
    database
      .select({
        action: adminAuditLogs.action,
        correlationId: adminAuditLogs.correlationId,
        id: adminAuditLogs.id,
        occurredAt: adminAuditLogs.occurredAt,
        outcome: adminAuditLogs.outcome,
        reason: adminAuditLogs.reason,
        targetRecordVersion: adminAuditLogs.targetRecordVersion,
        targetType: adminAuditLogs.targetType,
        verificationDate: adminAuditLogs.verificationDate
      })
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.occurredAt))
      .limit(150),
    database
      .select()
      .from(riskMethodologyVersions)
      .orderBy(desc(riskMethodologyVersions.createdAt))
      .limit(50),
    database
      .select({
        category: productCategories.code,
        factorCode: riskMethodologyCategoryWeights.factorCode,
        methodologyVersionId: riskMethodologyCategoryWeights.methodologyVersionId,
        weight: riskMethodologyCategoryWeights.weight
      })
      .from(riskMethodologyCategoryWeights)
      .innerJoin(
        productCategories,
        eq(riskMethodologyCategoryWeights.categoryId, productCategories.id)
      )
      .orderBy(productCategories.code, riskMethodologyCategoryWeights.factorCode),
    database
      .select({
        conditionsText: eligibilityRules.conditionsText,
        eligibilityStatus: eligibilityRules.eligibilityStatus,
        id: eligibilityRules.id,
        investorClassification: eligibilityRules.investorClassification,
        jurisdictionCode: jurisdictions.isoCode,
        publicationStatus: eligibilityRules.publicationStatus,
        requiresKyc: eligibilityRules.requiresKyc,
        routeId: eligibilityRules.routeId,
        sourceId: sourceObservations.sourceId,
        sourceName: sourceRegistry.name,
        verifiedAt: eligibilityRules.verifiedAt,
        version: eligibilityRules.version
      })
      .from(eligibilityRules)
      .innerJoin(
        sourceObservations,
        eq(eligibilityRules.sourceObservationId, sourceObservations.id)
      )
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .innerJoin(jurisdictions, eq(eligibilityRules.jurisdictionId, jurisdictions.id))
      .where(isNull(eligibilityRules.effectiveTo))
      .orderBy(desc(eligibilityRules.createdAt))
      .limit(100),
    database
      .select({
        gatesPossible: redemptionTerms.gatesPossible,
        id: redemptionTerms.id,
        inKindPossible: redemptionTerms.inKindPossible,
        minimumAmount: redemptionTerms.minimumAmount,
        noticePeriodHours: redemptionTerms.noticePeriodHours,
        publicationStatus: redemptionTerms.publicationStatus,
        routeId: redemptionTerms.routeId,
        settlementPeriodHours: redemptionTerms.settlementPeriodHours,
        sourceId: sourceObservations.sourceId,
        sourceName: sourceRegistry.name,
        verifiedAt: redemptionTerms.verifiedAt,
        version: redemptionTerms.version,
        windowDescription: redemptionTerms.windowDescription
      })
      .from(redemptionTerms)
      .innerJoin(sourceObservations, eq(redemptionTerms.sourceObservationId, sourceObservations.id))
      .innerJoin(sourceRegistry, eq(sourceObservations.sourceId, sourceRegistry.id))
      .where(isNull(redemptionTerms.effectiveTo))
      .orderBy(desc(redemptionTerms.createdAt))
      .limit(100)
  ]);

  const catalog = deduplicateBy(catalogRaw, (row) => row.routeId).map((row) => ({
    ...row,
    eligibilitySummary: row.eligibilitySummary ?? null,
    sourceId: row.sourceId ?? null,
    verifiedAt: iso(row.verifiedAt),
    warnings: Array.isArray(row.warnings) ? row.warnings : []
  }));
  const sources = sourcesRaw.map((row) => ({
    attributionText: row.attributionText,
    canonicalUrl: row.canonicalUrl,
    code: row.code,
    expectedCadenceSeconds: row.expectedCadenceSeconds,
    freshnessThresholdSeconds: row.freshnessThresholdSeconds,
    id: row.id,
    licenceName: row.licenceName,
    licenceUrl: row.licenceUrl,
    name: row.name,
    ownerName: row.ownerName,
    priority: row.priority,
    publicationStatus: row.publicationStatus,
    removalProcedure: row.removalProcedure,
    reviewedAt: iso(row.reviewedAt),
    sourceType: row.sourceType,
    status: row.status,
    termsUrl: row.termsUrl,
    version: row.version
  }));
  const jurisdictionCodes = new Map(jurisdictionRows.map((row) => [row.id, row.isoCode] as const));
  const entities: AdminSnapshot["entities"] = [
    ...issuerRows.map((row) => ({
      entityType: "ISSUER" as const,
      finalityBlocks: null,
      id: row.id,
      identifier: row.legalName,
      jurisdictionIsoCode:
        row.jurisdictionId === null ? null : (jurisdictionCodes.get(row.jurisdictionId) ?? null),
      legalName: row.legalName,
      lifecycleStatus: row.lifecycleStatus,
      name: row.name,
      officialUrl: row.officialUrl,
      updatedAt: row.updatedAt.toISOString()
    })),
    ...protocolRows.map((row) => ({
      entityType: "PROTOCOL" as const,
      finalityBlocks: null,
      id: row.id,
      identifier: row.legalName,
      jurisdictionIsoCode:
        row.jurisdictionId === null ? null : (jurisdictionCodes.get(row.jurisdictionId) ?? null),
      legalName: row.legalName,
      lifecycleStatus: row.lifecycleStatus,
      name: row.name,
      officialUrl: row.officialUrl,
      updatedAt: row.updatedAt.toISOString()
    })),
    ...chainRows.map((row) => ({
      entityType: "CHAIN" as const,
      finalityBlocks: row.finalityBlocks,
      id: row.id,
      identifier: row.caip2Id,
      jurisdictionIsoCode: null,
      legalName: null,
      lifecycleStatus: row.lifecycleStatus,
      name: row.name,
      officialUrl: row.explorerBaseUrl,
      updatedAt: row.updatedAt.toISOString()
    })),
    ...custodianRows.map((row) => ({
      entityType: "CUSTODIAN" as const,
      finalityBlocks: null,
      id: row.id,
      identifier: row.legalName,
      jurisdictionIsoCode:
        row.jurisdictionId === null ? null : (jurisdictionCodes.get(row.jurisdictionId) ?? null),
      legalName: row.legalName,
      lifecycleStatus: row.lifecycleStatus,
      name: row.name,
      officialUrl: row.officialUrl,
      updatedAt: row.updatedAt.toISOString()
    }))
  ];
  const observations = observationsRaw.map((row) => ({
    confidence: row.confidence,
    entityId: row.entityId,
    entityType: row.entityType,
    id: row.id,
    metric: row.metric,
    normalizedValue: normalizedObservationValue(row),
    observedAt: row.observedAt.toISOString(),
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    status: row.status,
    unit: row.unit
  }));
  const qualityEvents = qualityRows.map((row) => ({
    detectedAt: row.detectedAt.toISOString(),
    details: row.details,
    entityId: row.entityId,
    entityType: row.entityType,
    eventType: row.eventType,
    id: row.id,
    metric: row.metric,
    primaryObservationId: row.primaryObservationId,
    resolution: row.resolution,
    resolvedAt: iso(row.resolvedAt),
    severity: row.severity
  }));
  const accessTerms: AdminSnapshot["accessTerms"] = [
    ...eligibilityRows
      .filter((row): row is typeof row & { routeId: string } => row.routeId !== null)
      .map((row) => ({
        detail: `${row.jurisdictionCode} · ${row.investorClassification} · ${row.eligibilityStatus} · KYC ${row.requiresKyc === null ? "unknown" : row.requiresKyc ? "required" : "not required"}${row.conditionsText ? ` · ${row.conditionsText}` : ""}`,
        id: row.id,
        publicationStatus: row.publicationStatus,
        routeId: row.routeId,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        type: "ELIGIBILITY" as const,
        verifiedAt: iso(row.verifiedAt),
        version: row.version
      })),
    ...redemptionRows
      .filter((row): row is typeof row & { routeId: string } => row.routeId !== null)
      .map((row) => ({
        detail: [
          row.windowDescription,
          row.noticePeriodHours === null ? null : `${row.noticePeriodHours}h notice`,
          row.settlementPeriodHours === null ? null : `${row.settlementPeriodHours}h settlement`,
          row.minimumAmount === null ? null : `minimum ${row.minimumAmount}`,
          row.gatesPossible === null
            ? null
            : `gates ${row.gatesPossible ? "possible" : "not reported"}`,
          row.inKindPossible === null
            ? null
            : `in-kind ${row.inKindPossible ? "possible" : "not reported"}`
        ]
          .filter((value): value is string => value !== null)
          .join(" · "),
        id: row.id,
        publicationStatus: row.publicationStatus,
        routeId: row.routeId,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        type: "REDEMPTION" as const,
        verifiedAt: iso(row.verifiedAt),
        version: row.version
      }))
  ];
  const weightsByMethodology = new Map<string, AdminSnapshot["methodologies"][number]["weights"]>();
  for (const row of methodologyWeightRows) {
    const current = weightsByMethodology.get(row.methodologyVersionId) ?? [];
    current.push({
      category: row.category,
      factorCode: row.factorCode,
      weightPct: new Decimal(row.weight).mul(100).toString()
    });
    weightsByMethodology.set(row.methodologyVersionId, current);
  }

  return {
    accessTerms,
    adapterHealth: healthRows.map((row) => ({
      ...row,
      attemptedAt: row.attemptedAt.toISOString()
    })),
    assets: assetRows,
    audits: auditRows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      verificationDate: iso(row.verificationDate)
    })),
    catalog,
    deliveries: deliveryRows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: iso(row.deliveredAt)
    })),
    entities,
    generatedAt: new Date().toISOString(),
    jobs: jobRows.map((row) => ({
      ...row,
      completedAt: iso(row.completedAt),
      queuedAt: row.queuedAt.toISOString()
    })),
    methodologies: methodologyRows.map((row) => ({
      calculationVersion: row.calculationVersion,
      configuration: row.configuration,
      description: row.description,
      effectiveFrom: row.effectiveFrom.toISOString(),
      id: row.id,
      publicationStatus: row.publicationStatus,
      publishedAt: iso(row.publishedAt),
      reviewedAt: iso(row.reviewedAt),
      version: row.version,
      weights: weightsByMethodology.get(row.id) ?? []
    })),
    observations,
    qualityEvents,
    sources
  };
}

export async function getSecurityAuditSnapshot(database: Database) {
  const rows = await database
    .select({
      correlationId: securityAuditEvents.correlationId,
      eventType: securityAuditEvents.eventType,
      expiresAt: securityAuditEvents.expiresAt,
      id: securityAuditEvents.id,
      occurredAt: securityAuditEvents.occurredAt,
      outcome: securityAuditEvents.outcome
    })
    .from(securityAuditEvents)
    .orderBy(desc(securityAuditEvents.occurredAt))
    .limit(150);
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    occurredAt: row.occurredAt.toISOString()
  }));
}

export class AdminOperationError extends Error {
  public readonly kind: "CONFLICT" | "NOT_FOUND";

  public constructor(kind: "CONFLICT" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "AdminOperationError";
    this.kind = kind;
  }
}

const sourceValues = (
  input: Extract<AdminAction, { action: "SOURCE_CREATE" | "SOURCE_VERSION" }>
) => ({
  attributionText: input.attributionText,
  canonicalUrl: input.canonicalUrl,
  code: input.code,
  expectedCadenceSeconds: input.expectedCadenceSeconds,
  freshnessThresholdSeconds: input.freshnessThresholdSeconds,
  licenceName: input.licenceName,
  licenceUrl: input.licenceUrl,
  name: input.name,
  ownerName: input.ownerName,
  priority: input.priority,
  rateLimitPolicy: {},
  removalProcedure: input.removalProcedure,
  sourceType: input.sourceType,
  termsUrl: input.termsUrl
});

export async function executeAdminAction(
  database: Database,
  actorUserId: string,
  input: AdminAction
): Promise<{ correlationId: string; data: Record<string, unknown> }> {
  const correlationId = randomUUID();
  const now = new Date();
  const verificationDate = new Date(input.verificationDate);
  if (verificationDate > now) {
    throw new AdminOperationError("CONFLICT", "Verification time cannot be in the future");
  }

  if (input.action === "SOURCE_CREATE") {
    const data = await database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(sourceRegistry)
        .values({ ...sourceValues(input), publicationStatus: "DRAFT" })
        .returning();
      if (!created) throw new AdminOperationError("CONFLICT", "Source was not created");
      await transaction.insert(adminAuditLogs).values({
        action: "SOURCE_CREATE",
        actorUserId,
        afterValue: created,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: created.id,
        targetId: created.id,
        targetRecordVersion: created.version,
        targetType: "SOURCE_REGISTRY",
        verificationDate
      });
      return { id: created.id, version: created.version };
    });
    return { correlationId, data };
  }

  if (input.action === "SOURCE_VERSION") {
    const data = await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(sourceRegistry)
        .where(eq(sourceRegistry.id, input.id))
        .limit(1);
      if (!current) throw new AdminOperationError("NOT_FOUND", "Source not found");
      const [latest] = await transaction
        .select({ id: sourceRegistry.id, version: sourceRegistry.version })
        .from(sourceRegistry)
        .where(eq(sourceRegistry.logicalId, current.logicalId))
        .orderBy(desc(sourceRegistry.version))
        .limit(1);
      if (!latest || latest.id !== current.id)
        throw new AdminOperationError("CONFLICT", "Only the current source version can be edited");
      const [created] = await transaction
        .insert(sourceRegistry)
        .values({
          ...sourceValues(input),
          logicalId: current.logicalId,
          publicationStatus: "DRAFT",
          version: current.version + 1
        })
        .returning();
      if (!created) throw new AdminOperationError("CONFLICT", "Source version was not created");
      await transaction.insert(adminAuditLogs).values({
        action: "SOURCE_VERSION_CREATE",
        actorUserId,
        afterValue: created,
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: created.id,
        targetId: created.id,
        targetRecordVersion: created.version,
        targetType: "SOURCE_REGISTRY",
        verificationDate
      });
      return { id: created.id, version: created.version };
    });
    return { correlationId, data };
  }

  if (input.action === "SOURCE_TRANSITION") {
    const data = await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(sourceRegistry)
        .where(eq(sourceRegistry.id, input.id))
        .limit(1);
      if (!current) throw new AdminOperationError("NOT_FOUND", "Source not found");
      const [latest] = await transaction
        .select({ id: sourceRegistry.id })
        .from(sourceRegistry)
        .where(eq(sourceRegistry.logicalId, current.logicalId))
        .orderBy(desc(sourceRegistry.version))
        .limit(1);
      if (!latest || latest.id !== current.id)
        throw new AdminOperationError(
          "CONFLICT",
          "Only the current source version can change publication state"
        );
      const update =
        input.transition === "REVIEW"
          ? current.publicationStatus === "DRAFT"
            ? { publicationStatus: "REVIEWED" as const, reviewedAt: now }
            : null
          : input.transition === "PUBLISH"
            ? current.publicationStatus === "REVIEWED"
              ? {
                  publicationStatus: "PUBLISHED" as const,
                  publishedAt: now,
                  status: "ACTIVE" as const
                }
              : null
            : input.transition === "REJECT"
              ? ["DRAFT", "REVIEWED"].includes(current.publicationStatus)
                ? { publicationStatus: "REJECTED" as const, status: "DISABLED" as const }
                : null
              : current.publicationStatus !== "ARCHIVED"
                ? {
                    archivedAt: now,
                    publicationStatus: "ARCHIVED" as const,
                    status: "REMOVED" as const
                  }
                : null;
      if (update === null)
        throw new AdminOperationError("CONFLICT", "Source transition is not allowed");
      const previousPublished =
        input.transition === "PUBLISH"
          ? await transaction
              .select()
              .from(sourceRegistry)
              .where(
                and(
                  eq(sourceRegistry.logicalId, current.logicalId),
                  ne(sourceRegistry.id, current.id),
                  eq(sourceRegistry.publicationStatus, "PUBLISHED")
                )
              )
          : [];
      if (input.transition === "PUBLISH") {
        await transaction
          .update(sourceRegistry)
          .set({ publicationStatus: "SUPERSEDED", status: "DISABLED", updatedAt: now })
          .where(
            and(
              eq(sourceRegistry.logicalId, current.logicalId),
              ne(sourceRegistry.id, current.id),
              eq(sourceRegistry.publicationStatus, "PUBLISHED")
            )
          );
      }
      const [changed] = await transaction
        .update(sourceRegistry)
        .set({ ...update, updatedAt: now })
        .where(eq(sourceRegistry.id, current.id))
        .returning();
      if (!changed) throw new AdminOperationError("CONFLICT", "Source transition failed");
      await transaction.insert(adminAuditLogs).values({
        action: `SOURCE_${input.transition}`,
        actorUserId,
        afterValue: {
          current: changed,
          supersededIds: previousPublished.map((source) => source.id)
        },
        beforeValue: { current, previousPublished },
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: current.id,
        targetId: current.id,
        targetRecordVersion: current.version,
        targetType: "SOURCE_REGISTRY",
        verificationDate
      });
      return { id: changed.id, status: changed.publicationStatus };
    });
    return { correlationId, data };
  }

  if (input.action === "ENTITY_UPSERT") {
    const data = await database.transaction(async (transaction) => {
      const [source] = await transaction
        .select({
          id: sourceRegistry.id,
          publicationStatus: sourceRegistry.publicationStatus,
          status: sourceRegistry.status
        })
        .from(sourceRegistry)
        .where(eq(sourceRegistry.id, input.sourceId))
        .limit(1);
      if (
        !source ||
        source.status === "REMOVED" ||
        (source.publicationStatus !== "REVIEWED" && source.publicationStatus !== "PUBLISHED")
      )
        throw new AdminOperationError("CONFLICT", "A reviewed current source is required");
      let jurisdictionId: string | null = null;
      if (input.jurisdictionIsoCode !== null) {
        const [jurisdiction] = await transaction
          .select({ id: jurisdictions.id })
          .from(jurisdictions)
          .where(
            and(
              eq(jurisdictions.isoCode, input.jurisdictionIsoCode),
              isNull(jurisdictions.subdivisionCode)
            )
          )
          .limit(1);
        if (!jurisdiction)
          throw new AdminOperationError(
            "CONFLICT",
            "Jurisdiction metadata must exist before assigning it to an entity"
          );
        jurisdictionId = jurisdiction.id;
      }
      let beforeValue: unknown = null;
      let afterValue: { id: string; [key: string]: unknown };
      if (input.entityType === "ISSUER") {
        const [current] = input.id
          ? await transaction.select().from(issuers).where(eq(issuers.id, input.id)).limit(1)
          : [];
        beforeValue = current ?? null;
        const values = {
          archivedAt: input.lifecycleStatus === "ARCHIVED" ? now : null,
          jurisdictionId,
          legalName: input.legalName,
          lifecycleStatus: input.lifecycleStatus,
          name: input.name,
          officialUrl: input.officialUrl,
          updatedAt: now
        };
        const [changed] = current
          ? await transaction
              .update(issuers)
              .set(values)
              .where(eq(issuers.id, current.id))
              .returning()
          : await transaction.insert(issuers).values(values).returning();
        if (!changed) throw new AdminOperationError("CONFLICT", "Issuer mutation failed");
        afterValue = changed;
      } else if (input.entityType === "PROTOCOL") {
        const [current] = input.id
          ? await transaction.select().from(protocols).where(eq(protocols.id, input.id)).limit(1)
          : [];
        beforeValue = current ?? null;
        const values = {
          archivedAt: input.lifecycleStatus === "ARCHIVED" ? now : null,
          jurisdictionId,
          legalName: input.legalName,
          lifecycleStatus: input.lifecycleStatus,
          name: input.name,
          officialUrl: input.officialUrl,
          updatedAt: now
        };
        const [changed] = current
          ? await transaction
              .update(protocols)
              .set(values)
              .where(eq(protocols.id, current.id))
              .returning()
          : await transaction.insert(protocols).values(values).returning();
        if (!changed) throw new AdminOperationError("CONFLICT", "Protocol mutation failed");
        afterValue = changed;
      } else if (input.entityType === "CUSTODIAN") {
        const [current] = input.id
          ? await transaction.select().from(custodians).where(eq(custodians.id, input.id)).limit(1)
          : [];
        beforeValue = current ?? null;
        const values = {
          archivedAt: input.lifecycleStatus === "ARCHIVED" ? now : null,
          jurisdictionId,
          legalName: input.legalName,
          lifecycleStatus: input.lifecycleStatus,
          name: input.name,
          officialUrl: input.officialUrl,
          updatedAt: now
        };
        const [changed] = current
          ? await transaction
              .update(custodians)
              .set(values)
              .where(eq(custodians.id, current.id))
              .returning()
          : await transaction.insert(custodians).values(values).returning();
        if (!changed) throw new AdminOperationError("CONFLICT", "Custodian mutation failed");
        afterValue = changed;
      } else {
        const [current] = input.id
          ? await transaction.select().from(chains).where(eq(chains.id, input.id)).limit(1)
          : [];
        beforeValue = current ?? null;
        if (input.caip2Id === null)
          throw new AdminOperationError("CONFLICT", "A CAIP-2 identifier is required");
        const values = {
          archivedAt: input.lifecycleStatus === "ARCHIVED" ? now : null,
          caip2Id: input.caip2Id,
          explorerBaseUrl: input.explorerBaseUrl,
          finalityBlocks: input.finalityBlocks,
          lifecycleStatus: input.lifecycleStatus,
          name: input.name,
          updatedAt: now
        };
        const [changed] = current
          ? await transaction
              .update(chains)
              .set(values)
              .where(eq(chains.id, current.id))
              .returning()
          : await transaction.insert(chains).values(values).returning();
        if (!changed) throw new AdminOperationError("CONFLICT", "Chain mutation failed");
        afterValue = changed;
      }
      const targetId = afterValue.id;
      const [lastAudit] = await transaction
        .select({ version: adminAuditLogs.targetRecordVersion })
        .from(adminAuditLogs)
        .where(
          and(
            eq(adminAuditLogs.targetType, `ENTITY_${input.entityType}`),
            eq(adminAuditLogs.targetId, targetId)
          )
        )
        .orderBy(desc(adminAuditLogs.targetRecordVersion))
        .limit(1);
      const recordVersion = (lastAudit?.version ?? 0) + 1;
      await transaction.insert(adminAuditLogs).values({
        action: input.id === null ? "ENTITY_CREATE" : "ENTITY_METADATA_VERSION",
        actorUserId,
        afterValue,
        beforeValue,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: source.id,
        targetId,
        targetRecordVersion: recordVersion,
        targetType: `ENTITY_${input.entityType}`,
        verificationDate
      });
      return { id: targetId, version: recordVersion };
    });
    return { correlationId, data };
  }

  if (input.action === "ACCESS_TERMS_VERSION") {
    const data = await database.transaction(async (transaction) => {
      const [route] = await transaction
        .select({ id: productRoutes.id, version: productRoutes.version })
        .from(productRoutes)
        .where(and(eq(productRoutes.id, input.routeId), isNull(productRoutes.effectiveTo)))
        .limit(1);
      if (!route) throw new AdminOperationError("NOT_FOUND", "Current route not found");
      const [source] = await transaction
        .select({
          code: sourceRegistry.code,
          id: sourceRegistry.id,
          version: sourceRegistry.version
        })
        .from(sourceRegistry)
        .where(
          and(
            eq(sourceRegistry.id, input.sourceId),
            ne(sourceRegistry.status, "REMOVED"),
            or(
              eq(sourceRegistry.publicationStatus, "REVIEWED"),
              eq(sourceRegistry.publicationStatus, "PUBLISHED")
            )
          )
        )
        .limit(1);
      if (!source) throw new AdminOperationError("CONFLICT", "Current source not found");
      const createObservation = async (
        metric: string,
        valueType: "JSON" | "TEXT",
        value: unknown,
        unit: string
      ) => {
        const payload = jsonText(value);
        const hash = createHash("sha256")
          .update(`${input.routeId}:${metric}:${payload}:${verificationDate.toISOString()}`)
          .digest("hex");
        const [observation] = await transaction
          .insert(sourceObservations)
          .values({
            adapterVersion: ADMIN_ADAPTER_VERSION,
            confidence: "MANUALLY_VERIFIED",
            correlationId,
            entityId: input.routeId,
            entityType: "PRODUCT_ROUTE",
            externalEntityId: input.routeId,
            fetchedAt: now,
            idempotencyKey: `admin:${hash}`,
            metric,
            normalizedJsonValue: valueType === "JSON" ? value : null,
            normalizedTextValue: valueType === "TEXT" ? String(value) : null,
            observedAt: verificationDate,
            provenanceHash: hash,
            sourceId: source.id,
            sourceRevision: `${source.code}:v${source.version}`,
            status: "AVAILABLE",
            unit,
            valueType,
            verifiedAt: now
          })
          .returning({ id: sourceObservations.id });
        if (!observation)
          throw new AdminOperationError("CONFLICT", "Source observation was not created");
        return observation.id;
      };
      const created: Record<string, unknown> = {};
      let highestVersion = route.version;
      if (input.eligibility !== null) {
        let [jurisdiction] = await transaction
          .select({ id: jurisdictions.id })
          .from(jurisdictions)
          .where(
            and(
              eq(jurisdictions.isoCode, input.eligibility.jurisdictionIsoCode),
              isNull(jurisdictions.subdivisionCode)
            )
          )
          .limit(1);
        if (!jurisdiction) {
          [jurisdiction] = await transaction
            .insert(jurisdictions)
            .values({
              isoCode: input.eligibility.jurisdictionIsoCode,
              name: input.eligibility.jurisdictionName
            })
            .returning({ id: jurisdictions.id });
        }
        if (!jurisdiction)
          throw new AdminOperationError("CONFLICT", "Jurisdiction was not created");
        const [previous] = await transaction
          .select({ logicalId: eligibilityRules.logicalId, version: eligibilityRules.version })
          .from(eligibilityRules)
          .where(
            and(
              eq(eligibilityRules.routeId, route.id),
              eq(eligibilityRules.jurisdictionId, jurisdiction.id),
              eq(eligibilityRules.investorClassification, input.eligibility.investorClassification)
            )
          )
          .orderBy(desc(eligibilityRules.version))
          .limit(1);
        const observationId = await createObservation(
          "ELIGIBILITY",
          "JSON",
          input.eligibility,
          "POLICY"
        );
        const [rule] = await transaction
          .insert(eligibilityRules)
          .values({
            conditionsText: input.eligibility.conditionsText,
            effectiveFrom: now,
            eligibilityStatus: input.eligibility.eligibilityStatus,
            investorClassification: input.eligibility.investorClassification,
            jurisdictionId: jurisdiction.id,
            ...(previous ? { logicalId: previous.logicalId, version: previous.version + 1 } : {}),
            publicationStatus: "DRAFT",
            requiresKyc: input.eligibility.requiresKyc,
            routeId: route.id,
            sourceObservationId: observationId,
            verifiedAt: verificationDate
          })
          .returning({ id: eligibilityRules.id, version: eligibilityRules.version });
        if (!rule) throw new AdminOperationError("CONFLICT", "Eligibility version was not created");
        created.eligibilityId = rule.id;
        highestVersion = Math.max(highestVersion, rule.version);
      }
      if (input.redemption !== null) {
        const [previous] = await transaction
          .select({ logicalId: redemptionTerms.logicalId, version: redemptionTerms.version })
          .from(redemptionTerms)
          .where(eq(redemptionTerms.routeId, route.id))
          .orderBy(desc(redemptionTerms.version))
          .limit(1);
        const observationId = await createObservation(
          "REDEMPTION_TERMS",
          "JSON",
          input.redemption,
          "POLICY"
        );
        const [terms] = await transaction
          .insert(redemptionTerms)
          .values({
            effectiveFrom: now,
            gatesPossible: input.redemption.gatesPossible,
            inKindPossible: input.redemption.inKindPossible,
            ...(previous ? { logicalId: previous.logicalId, version: previous.version + 1 } : {}),
            minimumAmount: input.redemption.minimumAmount,
            minimumAmountAssetId: input.redemption.minimumAmountAssetId,
            noticePeriodHours: input.redemption.noticePeriodHours,
            publicationStatus: "DRAFT",
            routeId: route.id,
            settlementPeriodHours: input.redemption.settlementPeriodHours,
            sourceObservationId: observationId,
            verifiedAt: verificationDate,
            windowDescription: input.redemption.windowDescription
          })
          .returning({ id: redemptionTerms.id, version: redemptionTerms.version });
        if (!terms) throw new AdminOperationError("CONFLICT", "Redemption version was not created");
        created.redemptionId = terms.id;
        highestVersion = Math.max(highestVersion, terms.version);
      }
      if (input.sourceLinkUrl !== null) {
        created.sourceLinkObservationId = await createObservation(
          "SOURCE_LINK",
          "TEXT",
          input.sourceLinkUrl,
          "URL"
        );
      }
      await transaction.insert(adminAuditLogs).values({
        action: "ACCESS_TERMS_VERSION_CREATE",
        actorUserId,
        afterValue: { ...created, input },
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: source.id,
        targetId: route.id,
        targetRecordVersion: highestVersion,
        targetType: "PRODUCT_ROUTE_ACCESS",
        verificationDate
      });
      return created;
    });
    return { correlationId, data };
  }

  if (input.action === "ACCESS_TERMS_TRANSITION") {
    const data = await database.transaction(async (transaction) => {
      if (input.recordType === "ELIGIBILITY") {
        const [current] = await transaction
          .select()
          .from(eligibilityRules)
          .where(eq(eligibilityRules.id, input.id))
          .limit(1);
        if (!current) throw new AdminOperationError("NOT_FOUND", "Eligibility rule not found");
        const [observation] = await transaction
          .select({ sourceId: sourceObservations.sourceId })
          .from(sourceObservations)
          .where(eq(sourceObservations.id, current.sourceObservationId))
          .limit(1);
        if (!observation || observation.sourceId !== input.sourceId)
          throw new AdminOperationError(
            "CONFLICT",
            "The transition source must match the versioned eligibility evidence"
          );
        const update =
          input.transition === "REVIEW"
            ? current.publicationStatus === "DRAFT"
              ? { publicationStatus: "REVIEWED" as const, verifiedAt: verificationDate }
              : null
            : input.transition === "PUBLISH"
              ? current.publicationStatus === "REVIEWED"
                ? { effectiveFrom: now, publicationStatus: "PUBLISHED" as const }
                : null
              : input.transition === "REJECT"
                ? ["DRAFT", "REVIEWED"].includes(current.publicationStatus)
                  ? { publicationStatus: "REJECTED" as const }
                  : null
                : current.publicationStatus !== "ARCHIVED"
                  ? { archivedAt: now, effectiveTo: now, publicationStatus: "ARCHIVED" as const }
                  : null;
        if (!update) throw new AdminOperationError("CONFLICT", "Transition is not allowed");
        const previousPublished =
          input.transition === "PUBLISH"
            ? await transaction
                .select()
                .from(eligibilityRules)
                .where(
                  and(
                    eq(eligibilityRules.logicalId, current.logicalId),
                    ne(eligibilityRules.id, current.id),
                    eq(eligibilityRules.publicationStatus, "PUBLISHED"),
                    isNull(eligibilityRules.effectiveTo)
                  )
                )
            : [];
        if (input.transition === "PUBLISH") {
          await transaction
            .update(eligibilityRules)
            .set({ effectiveTo: now, publicationStatus: "SUPERSEDED" })
            .where(
              and(
                eq(eligibilityRules.logicalId, current.logicalId),
                ne(eligibilityRules.id, current.id),
                eq(eligibilityRules.publicationStatus, "PUBLISHED"),
                isNull(eligibilityRules.effectiveTo)
              )
            );
        }
        const [changed] = await transaction
          .update(eligibilityRules)
          .set(update)
          .where(eq(eligibilityRules.id, current.id))
          .returning();
        if (!changed) throw new AdminOperationError("CONFLICT", "Transition failed");
        await transaction.insert(adminAuditLogs).values({
          action: `ELIGIBILITY_${input.transition}`,
          actorUserId,
          afterValue: {
            current: changed,
            supersededIds: previousPublished.map((rule) => rule.id)
          },
          beforeValue: { current, previousPublished },
          correlationId,
          occurredAt: now,
          outcome: "APPROVED",
          reason: input.reason,
          sourceId: input.sourceId,
          targetId: current.id,
          targetRecordVersion: current.version,
          targetType: "ELIGIBILITY_RULE",
          verificationDate
        });
        return { id: current.id, status: changed.publicationStatus };
      }
      const [current] = await transaction
        .select()
        .from(redemptionTerms)
        .where(eq(redemptionTerms.id, input.id))
        .limit(1);
      if (!current) throw new AdminOperationError("NOT_FOUND", "Redemption terms not found");
      const [observation] = await transaction
        .select({ sourceId: sourceObservations.sourceId })
        .from(sourceObservations)
        .where(eq(sourceObservations.id, current.sourceObservationId))
        .limit(1);
      if (!observation || observation.sourceId !== input.sourceId)
        throw new AdminOperationError(
          "CONFLICT",
          "The transition source must match the versioned redemption evidence"
        );
      const update =
        input.transition === "REVIEW"
          ? current.publicationStatus === "DRAFT"
            ? { publicationStatus: "REVIEWED" as const, verifiedAt: verificationDate }
            : null
          : input.transition === "PUBLISH"
            ? current.publicationStatus === "REVIEWED"
              ? { effectiveFrom: now, publicationStatus: "PUBLISHED" as const }
              : null
            : input.transition === "REJECT"
              ? ["DRAFT", "REVIEWED"].includes(current.publicationStatus)
                ? { publicationStatus: "REJECTED" as const }
                : null
              : current.publicationStatus !== "ARCHIVED"
                ? { archivedAt: now, effectiveTo: now, publicationStatus: "ARCHIVED" as const }
                : null;
      if (!update) throw new AdminOperationError("CONFLICT", "Transition is not allowed");
      const previousPublished =
        input.transition === "PUBLISH"
          ? await transaction
              .select()
              .from(redemptionTerms)
              .where(
                and(
                  eq(redemptionTerms.logicalId, current.logicalId),
                  ne(redemptionTerms.id, current.id),
                  eq(redemptionTerms.publicationStatus, "PUBLISHED"),
                  isNull(redemptionTerms.effectiveTo)
                )
              )
          : [];
      if (input.transition === "PUBLISH") {
        await transaction
          .update(redemptionTerms)
          .set({ effectiveTo: now, publicationStatus: "SUPERSEDED" })
          .where(
            and(
              eq(redemptionTerms.logicalId, current.logicalId),
              ne(redemptionTerms.id, current.id),
              eq(redemptionTerms.publicationStatus, "PUBLISHED"),
              isNull(redemptionTerms.effectiveTo)
            )
          );
      }
      const [changed] = await transaction
        .update(redemptionTerms)
        .set(update)
        .where(eq(redemptionTerms.id, current.id))
        .returning();
      if (!changed) throw new AdminOperationError("CONFLICT", "Transition failed");
      await transaction.insert(adminAuditLogs).values({
        action: `REDEMPTION_${input.transition}`,
        actorUserId,
        afterValue: {
          current: changed,
          supersededIds: previousPublished.map((terms) => terms.id)
        },
        beforeValue: { current, previousPublished },
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: input.sourceId,
        targetId: current.id,
        targetRecordVersion: current.version,
        targetType: "REDEMPTION_TERMS",
        verificationDate
      });
      return { id: current.id, status: changed.publicationStatus };
    });
    return { correlationId, data };
  }

  if (input.action === "OBSERVATION_REVIEW") {
    const data = await database.transaction(async (transaction) => {
      const [observation] = await transaction
        .select()
        .from(sourceObservations)
        .where(eq(sourceObservations.id, input.observationId))
        .limit(1);
      if (!observation) throw new AdminOperationError("NOT_FOUND", "Observation not found");
      const [event] = await transaction
        .insert(dataQualityEvents)
        .values({
          correlationId,
          details: {
            annotation: input.annotation,
            assessment: input.assessment,
            nonDestructive: true,
            overrideStatus: input.overrideStatus
          },
          detectedAt: now,
          entityId: observation.entityId,
          entityType: observation.entityType,
          eventType: "MANUAL_OVERRIDE",
          metric: observation.metric,
          primaryObservationId: observation.id,
          severity: input.assessment === "NOTE" ? "INFO" : "WARNING"
        })
        .returning({ id: dataQualityEvents.id });
      if (!event) throw new AdminOperationError("CONFLICT", "Review event was not created");
      const [lastAudit] = await transaction
        .select({ version: adminAuditLogs.targetRecordVersion })
        .from(adminAuditLogs)
        .where(
          and(
            eq(adminAuditLogs.targetType, "SOURCE_OBSERVATION"),
            eq(adminAuditLogs.targetId, observation.id)
          )
        )
        .orderBy(desc(adminAuditLogs.targetRecordVersion))
        .limit(1);
      const recordVersion = (lastAudit?.version ?? 0) + 1;
      await transaction.insert(adminAuditLogs).values({
        action: "OBSERVATION_ANNOTATE_OVERRIDE",
        actorUserId,
        afterValue: { eventId: event.id, input },
        beforeValue: observation,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: observation.sourceId,
        targetId: observation.id,
        targetRecordVersion: recordVersion,
        targetType: "SOURCE_OBSERVATION",
        verificationDate
      });
      return { eventId: event.id, observationId: observation.id };
    });
    return { correlationId, data };
  }

  if (input.action === "QUALITY_RESOLVE") {
    const data = await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(dataQualityEvents)
        .where(eq(dataQualityEvents.id, input.id))
        .limit(1);
      if (!current) throw new AdminOperationError("NOT_FOUND", "Quality event not found");
      if (current.resolvedAt !== null)
        throw new AdminOperationError("CONFLICT", "Quality event is already resolved");
      const [changed] = await transaction
        .update(dataQualityEvents)
        .set({
          resolution: input.resolution,
          resolvedAt: now,
          resolvedByUserId: actorUserId
        })
        .where(eq(dataQualityEvents.id, current.id))
        .returning();
      if (!changed) throw new AdminOperationError("CONFLICT", "Quality event was not resolved");
      await transaction.insert(adminAuditLogs).values({
        action: "DATA_QUALITY_RESOLVE",
        actorUserId,
        afterValue: changed,
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        targetId: current.id,
        targetRecordVersion: 1,
        targetType: "DATA_QUALITY_EVENT",
        verificationDate
      });
      return { id: current.id, status: "RESOLVED" };
    });
    return { correlationId, data };
  }

  if (input.action === "METHODOLOGY_SAVE") {
    const data = await database.transaction(async (transaction) => {
      const categories = await transaction
        .select({ code: productCategories.code, id: productCategories.id })
        .from(productCategories);
      if (categories.length !== CATEGORY_VALUES.length)
        throw new AdminOperationError("CONFLICT", "Canonical categories are not seeded");
      const current = input.id
        ? (
            await transaction
              .select()
              .from(riskMethodologyVersions)
              .where(eq(riskMethodologyVersions.id, input.id))
              .limit(1)
          )[0]
        : undefined;
      if (input.id !== null && !current)
        throw new AdminOperationError("NOT_FOUND", "Methodology not found");
      if (current && current.publicationStatus !== "DRAFT")
        throw new AdminOperationError("CONFLICT", "Only a draft methodology can be edited");
      const previousWeights = current
        ? await transaction
            .select()
            .from(riskMethodologyCategoryWeights)
            .where(eq(riskMethodologyCategoryWeights.methodologyVersionId, current.id))
        : [];
      const methodologyValues = {
        calculationVersion: input.calculationVersion,
        configuration: {
          ...input.configuration,
          methodologyDocument: "RISK_METHODOLOGY.md",
          semanticVersion: input.version
        },
        description: input.description,
        effectiveFrom: new Date(input.effectiveFrom),
        version: input.version
      };
      const [methodology] = current
        ? await transaction
            .update(riskMethodologyVersions)
            .set(methodologyValues)
            .where(eq(riskMethodologyVersions.id, current.id))
            .returning()
        : await transaction
            .insert(riskMethodologyVersions)
            .values({ ...methodologyValues, publicationStatus: "DRAFT" })
            .returning();
      if (!methodology)
        throw new AdminOperationError("CONFLICT", "Methodology draft was not saved");
      const categoryIds = new Map(categories.map((category) => [category.code, category.id]));
      for (const weight of input.weights) {
        const categoryId = categoryIds.get(weight.category);
        if (!categoryId)
          throw new AdminOperationError("CONFLICT", `Unknown category ${weight.category}`);
        await transaction
          .insert(riskMethodologyCategoryWeights)
          .values({
            categoryId,
            factorCode: weight.factorCode,
            methodologyVersionId: methodology.id,
            missingEvidencePolicy: { mode: "UNKNOWN_RISK_PROXY" },
            penaltyConfiguration: {
              maxAnnualPenaltyPp: input.configuration.maxAnnualPenaltyPp
            },
            weight: new Decimal(weight.weightPct).div(100).toFixed(10)
          })
          .onConflictDoUpdate({
            set: {
              missingEvidencePolicy: { mode: "UNKNOWN_RISK_PROXY" },
              penaltyConfiguration: {
                maxAnnualPenaltyPp: input.configuration.maxAnnualPenaltyPp
              },
              weight: new Decimal(weight.weightPct).div(100).toFixed(10)
            },
            target: [
              riskMethodologyCategoryWeights.methodologyVersionId,
              riskMethodologyCategoryWeights.categoryId,
              riskMethodologyCategoryWeights.factorCode
            ]
          });
      }
      await transaction.insert(adminAuditLogs).values({
        action: current ? "METHODOLOGY_DRAFT_EDIT" : "METHODOLOGY_DRAFT_CREATE",
        actorUserId,
        afterValue: { methodology, weights: input.weights },
        beforeValue: current ? { methodology: current, weights: previousWeights } : null,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        targetId: methodology.id,
        targetRecordVersion: 1,
        targetType: "RISK_METHODOLOGY",
        verificationDate
      });
      return { id: methodology.id, status: methodology.publicationStatus };
    });
    return { correlationId, data };
  }

  const data = await database.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(riskMethodologyVersions)
      .where(eq(riskMethodologyVersions.id, input.id))
      .limit(1);
    if (!current) throw new AdminOperationError("NOT_FOUND", "Methodology not found");
    if (input.transition === "REVIEW") {
      if (current.publicationStatus !== "DRAFT")
        throw new AdminOperationError("CONFLICT", "Only drafts can be reviewed");
      const [changed] = await transaction
        .update(riskMethodologyVersions)
        .set({ publicationStatus: "REVIEWED", reviewedAt: now, reviewedByUserId: actorUserId })
        .where(eq(riskMethodologyVersions.id, current.id))
        .returning();
      if (!changed) throw new AdminOperationError("CONFLICT", "Methodology review failed");
      await transaction.insert(adminAuditLogs).values({
        action: "METHODOLOGY_REVIEW",
        actorUserId,
        afterValue: changed,
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        targetId: current.id,
        targetRecordVersion: 1,
        targetType: "RISK_METHODOLOGY",
        verificationDate
      });
      return { id: current.id, status: changed.publicationStatus };
    }
    if (input.transition === "REJECT") {
      if (current.publicationStatus !== "DRAFT" && current.publicationStatus !== "REVIEWED")
        throw new AdminOperationError("CONFLICT", "Only draft or reviewed methods can be rejected");
      const [changed] = await transaction
        .update(riskMethodologyVersions)
        .set({ publicationStatus: "REJECTED" })
        .where(eq(riskMethodologyVersions.id, current.id))
        .returning();
      if (!changed) throw new AdminOperationError("CONFLICT", "Methodology rejection failed");
      await transaction.insert(adminAuditLogs).values({
        action: "METHODOLOGY_REJECT",
        actorUserId,
        afterValue: changed,
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        targetId: current.id,
        targetRecordVersion: 1,
        targetType: "RISK_METHODOLOGY",
        verificationDate
      });
      return { id: current.id, status: changed.publicationStatus };
    }
    if (current.publicationStatus !== "REVIEWED")
      throw new AdminOperationError("CONFLICT", "A reviewed methodology is required");
    if (current.reviewedByUserId === actorUserId)
      throw new AdminOperationError(
        "CONFLICT",
        "The methodology publisher must be different from the reviewer"
      );
    const weights = await transaction
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
      .where(eq(riskMethodologyCategoryWeights.methodologyVersionId, current.id));
    for (const category of CATEGORY_VALUES) {
      const categoryWeights = weights.filter((weight) => weight.category === category);
      if (
        categoryWeights.length !== RISK_FACTORS.length ||
        !categoryWeights.reduce((sum, weight) => sum.plus(weight.weight), new Decimal(0)).eq(1)
      )
        throw new AdminOperationError(
          "CONFLICT",
          `${category} requires every factor and exactly 100% total weight`
        );
    }
    const previousPublished = await transaction
      .select()
      .from(riskMethodologyVersions)
      .where(
        and(
          eq(riskMethodologyVersions.publicationStatus, "PUBLISHED"),
          ne(riskMethodologyVersions.id, current.id),
          isNull(riskMethodologyVersions.effectiveTo)
        )
      );
    if (previousPublished.some((previous) => previous.effectiveFrom >= current.effectiveFrom))
      throw new AdminOperationError(
        "CONFLICT",
        "The new methodology must become effective after the current published version"
      );
    for (const previous of previousPublished) {
      await transaction
        .update(riskMethodologyVersions)
        .set({ effectiveTo: current.effectiveFrom, publicationStatus: "SUPERSEDED" })
        .where(eq(riskMethodologyVersions.id, previous.id));
    }
    const [changed] = await transaction
      .update(riskMethodologyVersions)
      .set({ publicationStatus: "PUBLISHED", publishedAt: now, publishedByUserId: actorUserId })
      .where(eq(riskMethodologyVersions.id, current.id))
      .returning();
    if (!changed) throw new AdminOperationError("CONFLICT", "Methodology publication failed");
    await transaction.insert(adminAuditLogs).values({
      action: "METHODOLOGY_PUBLISH",
      actorUserId,
      afterValue: { changed, supersededIds: previousPublished.map((previous) => previous.id) },
      beforeValue: { current, previousPublished },
      correlationId,
      occurredAt: now,
      outcome: "APPROVED",
      reason: input.reason,
      targetId: current.id,
      targetRecordVersion: 1,
      targetType: "RISK_METHODOLOGY",
      verificationDate
    });
    return { id: current.id, status: changed.publicationStatus };
  });
  return { correlationId, data };
}

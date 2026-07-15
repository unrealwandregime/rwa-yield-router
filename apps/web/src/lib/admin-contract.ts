import { RISK_FACTORS } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { z } from "zod";
import { CATEGORY_VALUES } from "@/lib/constants";

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "An HTTPS URL is required");
const reasonSchema = z.string().trim().min(8).max(2_000);
const verificationDateSchema = z.iso.datetime({ offset: true });
const nullableDateSchema = z.string().nullable();

export const sourceTypeValues = [
  "OFFICIAL_API",
  "OFFICIAL_DOCUMENT",
  "ONCHAIN",
  "ORACLE",
  "SUBGRAPH",
  "RPC",
  "THIRD_PARTY_API",
  "MANUAL_CURATED"
] as const;

export const publicationStatusValues = [
  "DRAFT",
  "REVIEWED",
  "PUBLISHED",
  "REJECTED",
  "ARCHIVED",
  "SUPERSEDED"
] as const;

export const lifecycleStatusValues = [
  "ACTIVE",
  "PAUSED",
  "RESTRICTED",
  "CLOSED",
  "UNAVAILABLE",
  "ARCHIVED"
] as const;

export const investorClassificationValues = [
  "RETAIL",
  "ACCREDITED",
  "QUALIFIED",
  "PROFESSIONAL",
  "INSTITUTIONAL",
  "UNKNOWN"
] as const;

export const methodologyWeightSchema = z
  .array(
    z
      .object({
        category: z.enum(CATEGORY_VALUES),
        factorCode: z.enum(RISK_FACTORS),
        weightPct: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,10})?$/u)
      })
      .strict()
  )
  .length(CATEGORY_VALUES.length * RISK_FACTORS.length)
  .superRefine((weights, context) => {
    const seen = new Set<string>();
    for (const weight of weights) {
      const key = `${weight.category}:${weight.factorCode}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: `Duplicate methodology weight ${key}` });
      }
      seen.add(key);
      const parsed = new Decimal(weight.weightPct);
      if (parsed.isNegative() || parsed.gt(100)) {
        context.addIssue({
          code: "custom",
          message: `${key} must be between 0 and 100 percent`
        });
      }
    }
    for (const category of CATEGORY_VALUES) {
      const categoryWeights = weights.filter((weight) => weight.category === category);
      const missing = RISK_FACTORS.filter(
        (factor) => !categoryWeights.some((weight) => weight.factorCode === factor)
      );
      if (missing.length > 0) {
        context.addIssue({
          code: "custom",
          message: `${category} is missing factors: ${missing.join(", ")}`
        });
        continue;
      }
      const total = categoryWeights.reduce(
        (sum, weight) => sum.plus(weight.weightPct),
        new Decimal(0)
      );
      if (!total.eq(100)) {
        context.addIssue({
          code: "custom",
          message: `${category} weights total ${total.toString()}%, not 100%`
        });
      }
    }
  });

const sourceFields = {
  attributionText: z.string().trim().max(1_000).nullable(),
  canonicalUrl: httpsUrlSchema,
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]{2,95}$/u),
  expectedCadenceSeconds: z.number().int().positive().max(31_536_000).nullable(),
  freshnessThresholdSeconds: z.number().int().positive().max(31_536_000).nullable(),
  licenceName: z.string().trim().max(160).nullable(),
  licenceUrl: httpsUrlSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(200),
  priority: z.number().int().min(0).max(10_000),
  removalProcedure: z.string().trim().min(8).max(2_000),
  sourceType: z.enum(sourceTypeValues),
  termsUrl: httpsUrlSchema.nullable()
} as const;

const sourceCreateSchema = z
  .object({
    action: z.literal("SOURCE_CREATE"),
    ...sourceFields,
    reason: reasonSchema,
    verificationDate: verificationDateSchema
  })
  .strict();

const sourceVersionSchema = z
  .object({
    action: z.literal("SOURCE_VERSION"),
    id: z.uuid(),
    ...sourceFields,
    reason: reasonSchema,
    verificationDate: verificationDateSchema
  })
  .strict();

const sourceTransitionSchema = z
  .object({
    action: z.literal("SOURCE_TRANSITION"),
    id: z.uuid(),
    reason: reasonSchema,
    transition: z.enum(["REVIEW", "PUBLISH", "REJECT", "ARCHIVE"]),
    verificationDate: verificationDateSchema
  })
  .strict();

const entityUpsertSchema = z
  .object({
    action: z.literal("ENTITY_UPSERT"),
    caip2Id: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}$/u)
      .nullable(),
    entityType: z.enum(["ISSUER", "PROTOCOL", "CHAIN", "CUSTODIAN"]),
    explorerBaseUrl: httpsUrlSchema.nullable(),
    finalityBlocks: z.number().int().min(0).max(10_000_000).nullable(),
    id: z.uuid().nullable(),
    jurisdictionIsoCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,3}$/u)
      .nullable(),
    legalName: z.string().trim().max(240).nullable(),
    lifecycleStatus: z.enum(lifecycleStatusValues),
    name: z.string().trim().min(1).max(200),
    officialUrl: httpsUrlSchema.nullable(),
    reason: reasonSchema,
    sourceId: z.uuid(),
    verificationDate: verificationDateSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.entityType === "CHAIN" && input.caip2Id === null) {
      context.addIssue({ code: "custom", message: "A chain requires a CAIP-2 identifier" });
    }
    if (input.entityType !== "CHAIN" && input.caip2Id !== null) {
      context.addIssue({ code: "custom", message: "CAIP-2 identifiers apply only to chains" });
    }
  });

const accessTermsVersionSchema = z
  .object({
    action: z.literal("ACCESS_TERMS_VERSION"),
    eligibility: z
      .object({
        conditionsText: z.string().trim().max(2_000).nullable(),
        eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "CONDITIONAL", "UNKNOWN"]),
        investorClassification: z.enum(investorClassificationValues),
        jurisdictionIsoCode: z
          .string()
          .trim()
          .regex(/^[A-Z]{2,3}$/u),
        jurisdictionName: z.string().trim().min(1).max(160),
        requiresKyc: z.boolean().nullable()
      })
      .strict()
      .nullable(),
    reason: reasonSchema,
    redemption: z
      .object({
        gatesPossible: z.boolean().nullable(),
        inKindPossible: z.boolean().nullable(),
        minimumAmount: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,18})?$/u)
          .nullable(),
        minimumAmountAssetId: z.uuid().nullable(),
        noticePeriodHours: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,6})?$/u)
          .nullable(),
        settlementPeriodHours: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,6})?$/u)
          .nullable(),
        windowDescription: z.string().trim().max(2_000).nullable()
      })
      .strict()
      .nullable(),
    routeId: z.uuid(),
    sourceId: z.uuid(),
    sourceLinkUrl: httpsUrlSchema.nullable(),
    verificationDate: verificationDateSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.eligibility === null && input.redemption === null && input.sourceLinkUrl === null) {
      context.addIssue({ code: "custom", message: "At least one sourced term must be supplied" });
    }
    if (
      input.eligibility?.eligibilityStatus === "CONDITIONAL" &&
      !input.eligibility.conditionsText
    ) {
      context.addIssue({
        code: "custom",
        message: "Conditional eligibility requires a conditions explanation"
      });
    }
    const redemption = input.redemption;
    if (
      redemption !== null &&
      (redemption.minimumAmount === null) !== (redemption.minimumAmountAssetId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Minimum redemption amount and asset must be supplied together"
      });
    }
  });

const accessTermsTransitionSchema = z
  .object({
    action: z.literal("ACCESS_TERMS_TRANSITION"),
    id: z.uuid(),
    reason: reasonSchema,
    recordType: z.enum(["ELIGIBILITY", "REDEMPTION"]),
    sourceId: z.uuid(),
    transition: z.enum(["REVIEW", "PUBLISH", "REJECT", "ARCHIVE"]),
    verificationDate: verificationDateSchema
  })
  .strict();

const observationReviewSchema = z
  .object({
    action: z.literal("OBSERVATION_REVIEW"),
    annotation: z.string().trim().min(3).max(2_000),
    assessment: z.enum(["STALE", "INCORRECT", "CONFLICT", "NOTE"]),
    observationId: z.uuid(),
    overrideStatus: z.enum(["STALE", "REJECTED", "CONFLICTED", "UNAVAILABLE"]).nullable(),
    reason: reasonSchema,
    verificationDate: verificationDateSchema
  })
  .strict();

const qualityResolveSchema = z
  .object({
    action: z.literal("QUALITY_RESOLVE"),
    id: z.uuid(),
    reason: reasonSchema,
    resolution: z.string().trim().min(3).max(2_000),
    verificationDate: verificationDateSchema
  })
  .strict();

const methodologySaveSchema = z
  .object({
    action: z.literal("METHODOLOGY_SAVE"),
    calculationVersion: z.string().trim().min(1).max(64),
    configuration: z
      .object({
        maxAnnualPenaltyPp: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,10})?$/u),
        minimumEvidenceCoveragePct: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,10})?$/u),
        unknownRiskProxy: z
          .string()
          .trim()
          .regex(/^\d+(?:\.\d{1,10})?$/u)
      })
      .strict(),
    description: z.string().trim().min(8).max(2_000),
    effectiveFrom: verificationDateSchema,
    id: z.uuid().nullable(),
    reason: reasonSchema,
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u),
    verificationDate: verificationDateSchema,
    weights: methodologyWeightSchema
  })
  .strict()
  .superRefine((input, context) => {
    for (const [key, value] of Object.entries(input.configuration)) {
      const parsed = new Decimal(value);
      if (parsed.isNegative() || parsed.gt(100)) {
        context.addIssue({ code: "custom", message: `${key} must be between 0 and 100` });
      }
    }
  });

const methodologyTransitionSchema = z
  .object({
    action: z.literal("METHODOLOGY_TRANSITION"),
    id: z.uuid(),
    reason: reasonSchema,
    transition: z.enum(["REVIEW", "PUBLISH", "REJECT"]),
    verificationDate: verificationDateSchema
  })
  .strict();

export const adminActionSchema = z.discriminatedUnion("action", [
  sourceCreateSchema,
  sourceVersionSchema,
  sourceTransitionSchema,
  entityUpsertSchema,
  accessTermsVersionSchema,
  accessTermsTransitionSchema,
  observationReviewSchema,
  qualityResolveSchema,
  methodologySaveSchema,
  methodologyTransitionSchema
]);

export type AdminAction = z.infer<typeof adminActionSchema>;

const catalogRowSchema = z
  .object({
    category: z.enum(CATEGORY_VALUES),
    chain: z.string().nullable(),
    discoveryStatus: z.string().nullable(),
    eligibilitySummary: z.string().nullable(),
    issuer: z.string().nullable(),
    lifecycleStatus: z.enum(lifecycleStatusValues),
    productId: z.uuid(),
    productName: z.string(),
    protocol: z.string().nullable(),
    publicationStatus: z.enum(publicationStatusValues),
    redemptionSummary: z.string().nullable(),
    routeId: z.uuid(),
    routeName: z.string(),
    routeSlug: z.string(),
    routeVersion: z.number().int().positive(),
    sourceId: z.uuid().nullable(),
    sourceName: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    symbol: z.string(),
    verifiedAt: nullableDateSchema,
    warnings: z.array(z.unknown())
  })
  .strict();

const sourceRowSchema = z
  .object({
    attributionText: z.string().nullable(),
    canonicalUrl: z.string(),
    code: z.string(),
    expectedCadenceSeconds: z.number().int().nullable(),
    freshnessThresholdSeconds: z.number().int().nullable(),
    id: z.uuid(),
    licenceName: z.string().nullable(),
    licenceUrl: z.string().nullable(),
    name: z.string(),
    ownerName: z.string(),
    priority: z.number().int(),
    publicationStatus: z.enum(publicationStatusValues),
    removalProcedure: z.string(),
    reviewedAt: nullableDateSchema,
    sourceType: z.enum(sourceTypeValues),
    status: z.enum(["ACTIVE", "DEGRADED", "DISABLED", "REMOVED"]),
    termsUrl: z.string().nullable(),
    version: z.number().int().positive()
  })
  .strict();

const entityRowSchema = z
  .object({
    entityType: z.enum(["ISSUER", "PROTOCOL", "CHAIN", "CUSTODIAN"]),
    finalityBlocks: z.number().int().nullable(),
    id: z.uuid(),
    identifier: z.string().nullable(),
    jurisdictionIsoCode: z.string().nullable(),
    legalName: z.string().nullable(),
    lifecycleStatus: z.enum(lifecycleStatusValues),
    name: z.string(),
    officialUrl: z.string().nullable(),
    updatedAt: z.string()
  })
  .strict();

const observationRowSchema = z
  .object({
    confidence: z.string(),
    entityId: z.string().nullable(),
    entityType: z.string(),
    id: z.uuid(),
    metric: z.string(),
    normalizedValue: z.string().nullable(),
    observedAt: z.string(),
    sourceId: z.uuid(),
    sourceName: z.string(),
    status: z.string(),
    unit: z.string()
  })
  .strict();

const qualityEventRowSchema = z
  .object({
    detectedAt: z.string(),
    details: z.unknown(),
    entityId: z.string().nullable(),
    entityType: z.string(),
    eventType: z.string(),
    id: z.uuid(),
    metric: z.string().nullable(),
    primaryObservationId: z.string().nullable(),
    resolution: z.string().nullable(),
    resolvedAt: nullableDateSchema,
    severity: z.string()
  })
  .strict();

const accessTermRowSchema = z
  .object({
    detail: z.string(),
    id: z.uuid(),
    publicationStatus: z.enum(publicationStatusValues),
    routeId: z.uuid(),
    sourceId: z.uuid(),
    sourceName: z.string(),
    type: z.enum(["ELIGIBILITY", "REDEMPTION"]),
    verifiedAt: nullableDateSchema,
    version: z.number().int().positive()
  })
  .strict();

const adapterHealthRowSchema = z
  .object({
    adapterVersion: z.string(),
    attemptedAt: z.string(),
    deadLetterCount: z.number().int(),
    durationMs: z.number(),
    errorCategory: z.string().nullable(),
    id: z.uuid(),
    outcome: z.string(),
    recordsAccepted: z.number().int(),
    recordsChanged: z.number().int(),
    recordsRejected: z.number().int(),
    retryCount: z.number().int(),
    sourceName: z.string(),
    staleRecordCount: z.number().int()
  })
  .strict();

const jobRowSchema = z
  .object({
    attempt: z.number().int(),
    completedAt: nullableDateSchema,
    correlationId: z.uuid(),
    deadLetterCount: z.number().int(),
    errorCategory: z.string().nullable(),
    id: z.uuid(),
    jobName: z.string(),
    queuedAt: z.string(),
    sourceName: z.string().nullable(),
    status: z.string()
  })
  .strict();

const deliveryRowSchema = z
  .object({
    attemptCount: z.number().int(),
    channel: z.string(),
    createdAt: z.string(),
    deliveredAt: nullableDateSchema,
    errorCategory: z.string().nullable(),
    id: z.uuid(),
    status: z.string()
  })
  .strict();

const auditRowSchema = z
  .object({
    action: z.string(),
    correlationId: z.uuid(),
    id: z.uuid(),
    occurredAt: z.string(),
    outcome: z.string(),
    reason: z.string(),
    targetRecordVersion: z.number().int().positive(),
    targetType: z.string(),
    verificationDate: nullableDateSchema
  })
  .strict();

const methodologyRowSchema = z
  .object({
    calculationVersion: z.string(),
    configuration: z.unknown(),
    description: z.string(),
    effectiveFrom: z.string(),
    id: z.uuid(),
    publicationStatus: z.enum(publicationStatusValues),
    publishedAt: nullableDateSchema,
    reviewedAt: nullableDateSchema,
    version: z.string(),
    weights: z.array(
      z
        .object({
          category: z.enum(CATEGORY_VALUES),
          factorCode: z.string(),
          weightPct: z.string()
        })
        .strict()
    )
  })
  .strict();

export const adminSnapshotSchema = z
  .object({
    data: z
      .object({
        accessTerms: z.array(accessTermRowSchema),
        adapterHealth: z.array(adapterHealthRowSchema),
        assets: z.array(z.object({ id: z.uuid(), name: z.string(), symbol: z.string() }).strict()),
        audits: z.array(auditRowSchema),
        catalog: z.array(catalogRowSchema),
        deliveries: z.array(deliveryRowSchema),
        entities: z.array(entityRowSchema),
        generatedAt: z.string(),
        jobs: z.array(jobRowSchema),
        methodologies: z.array(methodologyRowSchema),
        observations: z.array(observationRowSchema),
        qualityEvents: z.array(qualityEventRowSchema),
        sources: z.array(sourceRowSchema)
      })
      .strict()
  })
  .strict();

export type AdminSnapshot = z.infer<typeof adminSnapshotSchema>["data"];

export const securitySnapshotSchema = z
  .object({
    data: z.array(
      z
        .object({
          correlationId: z.uuid(),
          eventType: z.string(),
          expiresAt: z.string(),
          id: z.uuid(),
          occurredAt: z.string(),
          outcome: z.string()
        })
        .strict()
    )
  })
  .strict();

export const toCsvCell = (value: unknown): string => {
  const serialized =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const neutralized = /^[=+\-@\t\r]/u.test(serialized) ? `'${serialized}` : serialized;
  return `"${neutralized.replaceAll('"', '""')}"`;
};

export const createDataQualityCsv = (snapshot: AdminSnapshot): string => {
  const header = [
    "route_slug",
    "product",
    "route",
    "category",
    "publication_status",
    "lifecycle_status",
    "verified_at",
    "source",
    "source_url",
    "discovery_status",
    "open_quality_events"
  ];
  const openEventsByEntity = new Map<string, number>();
  for (const event of snapshot.qualityEvents) {
    if (event.resolvedAt !== null || event.entityId === null) continue;
    const key = `${event.entityType}:${event.entityId}`;
    openEventsByEntity.set(key, (openEventsByEntity.get(key) ?? 0) + 1);
  }
  const rows = snapshot.catalog.map((record) => [
    record.routeSlug,
    record.productName,
    record.routeName,
    record.category,
    record.publicationStatus,
    record.lifecycleStatus,
    record.verifiedAt,
    record.sourceName,
    record.sourceUrl,
    record.discoveryStatus,
    openEventsByEntity.get(`PRODUCT_ROUTE:${record.routeId}`) ?? 0
  ]);
  return [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\r\n");
};

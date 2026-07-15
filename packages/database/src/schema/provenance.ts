import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import {
  auditors,
  assets,
  custodians,
  jurisdictions,
  oracles,
  productRoutes,
  products
} from "./catalog.js";
import {
  adapterHealthOutcomeEnum,
  confidenceClassEnum,
  dataStatusEnum,
  eligibilityStatusEnum,
  investorClassificationEnum,
  publicationStatusEnum,
  qualityEventTypeEnum,
  sourceStatusEnum,
  sourceTypeEnum,
  observationValueTypeEnum
} from "./enums.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const sourceRegistry = pgTable(
  "source_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalId: uuid("logical_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    code: varchar("code", { length: 96 }).notNull(),
    name: text("name").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    ownerName: text("owner_name").notNull(),
    termsUrl: text("terms_url"),
    licenceName: text("licence_name"),
    licenceUrl: text("licence_url"),
    attributionText: text("attribution_text"),
    rateLimitPolicy: jsonb("rate_limit_policy")
      .notNull()
      .default(sql`'{}'::jsonb`),
    expectedCadenceSeconds: integer("expected_cadence_seconds"),
    freshnessThresholdSeconds: integer("freshness_threshold_seconds"),
    priority: integer("priority").notNull(),
    status: sourceStatusEnum("status").notNull().default("ACTIVE"),
    publicationStatus: publicationStatusEnum("publication_status").notNull().default("DRAFT"),
    reviewedAt: utcTimestamp("reviewed_at"),
    publishedAt: utcTimestamp("published_at"),
    removalProcedure: text("removal_procedure").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("source_registry_logical_version_unique").on(table.logicalId, table.version),
    unique("source_registry_code_version_unique").on(table.code, table.version),
    index("source_registry_status_priority_idx").on(table.status, table.priority),
    check("source_registry_version_positive", sql`${table.version} > 0`),
    check("source_registry_code_not_blank", sql`btrim(${table.code}) <> ''`),
    check("source_registry_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("source_registry_canonical_https", sql`${table.canonicalUrl} ~ '^https://'`),
    check(
      "source_registry_terms_https",
      sql`${table.termsUrl} is null or ${table.termsUrl} ~ '^https://'`
    ),
    check(
      "source_registry_licence_https",
      sql`${table.licenceUrl} is null or ${table.licenceUrl} ~ '^https://'`
    ),
    check("source_registry_priority_nonnegative", sql`${table.priority} >= 0`),
    check(
      "source_registry_cadence_positive",
      sql`${table.expectedCadenceSeconds} is null or ${table.expectedCadenceSeconds} > 0`
    ),
    check(
      "source_registry_freshness_positive",
      sql`${table.freshnessThresholdSeconds} is null or ${table.freshnessThresholdSeconds} > 0`
    ),
    check(
      "source_registry_rate_limit_object",
      sql`jsonb_typeof(${table.rateLimitPolicy}) = 'object'`
    ),
    check(
      "source_registry_publication_timestamp",
      sql`${table.publicationStatus} <> 'PUBLISHED' or ${table.publishedAt} is not null`
    )
  ]
);

export const sourceObservations = pgTable(
  "source_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sourceRegistry.id, { onDelete: "restrict", onUpdate: "cascade" }),
    externalEntityId: text("external_entity_id").notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id"),
    metric: varchar("metric", { length: 96 }).notNull(),
    observedAt: utcTimestamp("observed_at").notNull(),
    fetchedAt: utcTimestamp("fetched_at").notNull(),
    verifiedAt: utcTimestamp("verified_at"),
    confidence: confidenceClassEnum("confidence").notNull(),
    status: dataStatusEnum("status").notNull(),
    valueType: observationValueTypeEnum("value_type").notNull(),
    rawValue: jsonb("raw_value"),
    rawValueExpiresAt: utcTimestamp("raw_value_expires_at"),
    normalizedNumericValue: numeric("normalized_numeric_value", {
      precision: 38,
      scale: 18
    }),
    normalizedTextValue: text("normalized_text_value"),
    normalizedBooleanValue: boolean("normalized_boolean_value"),
    normalizedJsonValue: jsonb("normalized_json_value"),
    unit: varchar("unit", { length: 64 }).notNull(),
    sourceRevision: text("source_revision").notNull(),
    adapterVersion: varchar("adapter_version", { length: 64 }).notNull(),
    provenanceHash: varchar("provenance_hash", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("source_observations_idempotency_key_unique").on(table.idempotencyKey),
    unique("source_observations_provenance_hash_unique").on(table.provenanceHash),
    index("source_observations_entity_metric_time_idx").on(
      table.entityType,
      table.entityId,
      table.metric,
      table.observedAt
    ),
    index("source_observations_source_metric_time_idx").on(
      table.sourceId,
      table.metric,
      table.observedAt
    ),
    index("source_observations_status_time_idx").on(table.status, table.observedAt),
    check(
      "source_observations_external_entity_not_blank",
      sql`btrim(${table.externalEntityId}) <> ''`
    ),
    check("source_observations_entity_type_not_blank", sql`btrim(${table.entityType}) <> ''`),
    check("source_observations_metric_not_blank", sql`btrim(${table.metric}) <> ''`),
    check("source_observations_unit_not_blank", sql`btrim(${table.unit}) <> ''`),
    check(
      "source_observations_time_order",
      sql`${table.fetchedAt} >= ${table.observedAt} and (${table.verifiedAt} is null or ${table.verifiedAt} >= ${table.observedAt})`
    ),
    check(
      "source_observations_raw_expiry_order",
      sql`${table.rawValueExpiresAt} is null or ${table.rawValueExpiresAt} > ${table.fetchedAt}`
    ),
    check(
      "source_observations_value_shape",
      sql`(
        (${table.valueType} = 'NUMERIC' and ${table.normalizedNumericValue} is not null and num_nonnulls(${table.normalizedTextValue}, ${table.normalizedBooleanValue}, ${table.normalizedJsonValue}) = 0)
        or (${table.valueType} = 'TEXT' and ${table.normalizedTextValue} is not null and num_nonnulls(${table.normalizedNumericValue}, ${table.normalizedBooleanValue}, ${table.normalizedJsonValue}) = 0)
        or (${table.valueType} = 'BOOLEAN' and ${table.normalizedBooleanValue} is not null and num_nonnulls(${table.normalizedNumericValue}, ${table.normalizedTextValue}, ${table.normalizedJsonValue}) = 0)
        or (${table.valueType} = 'JSON' and ${table.normalizedJsonValue} is not null and num_nonnulls(${table.normalizedNumericValue}, ${table.normalizedTextValue}, ${table.normalizedBooleanValue}) = 0)
        or (${table.valueType} = 'NONE' and num_nonnulls(${table.normalizedNumericValue}, ${table.normalizedTextValue}, ${table.normalizedBooleanValue}, ${table.normalizedJsonValue}) = 0)
      )`
    ),
    check(
      "source_observations_unavailable_has_no_value",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or ${table.valueType} = 'NONE'`
    )
  ]
);

const effectiveRecordColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  logicalId: uuid("logical_id").notNull().defaultRandom(),
  version: integer("version").notNull().default(1),
  productId: uuid("product_id").references(() => products.id, {
    onDelete: "restrict" as const,
    onUpdate: "cascade" as const
  }),
  routeId: uuid("route_id").references(() => productRoutes.id, {
    onDelete: "restrict" as const,
    onUpdate: "cascade" as const
  }),
  sourceObservationId: uuid("source_observation_id")
    .notNull()
    .references(() => sourceObservations.id, {
      onDelete: "restrict" as const,
      onUpdate: "cascade" as const
    }),
  publicationStatus: publicationStatusEnum("publication_status").notNull().default("DRAFT"),
  effectiveFrom: utcTimestamp("effective_from").notNull(),
  effectiveTo: utcTimestamp("effective_to"),
  verifiedAt: utcTimestamp("verified_at"),
  createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  archivedAt: utcTimestamp("archived_at")
});

export const eligibilityRules = pgTable(
  "eligibility_rules",
  {
    ...effectiveRecordColumns(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    investorClassification: investorClassificationEnum("investor_classification").notNull(),
    eligibilityStatus: eligibilityStatusEnum("eligibility_status").notNull(),
    requiresKyc: boolean("requires_kyc"),
    conditionsText: text("conditions_text")
  },
  (table) => [
    unique("eligibility_rules_logical_version_unique").on(table.logicalId, table.version),
    index("eligibility_rules_target_lookup_idx").on(
      table.productId,
      table.routeId,
      table.jurisdictionId,
      table.investorClassification,
      table.effectiveFrom
    ),
    check("eligibility_rules_version_positive", sql`${table.version} > 0`),
    check(
      "eligibility_rules_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "eligibility_rules_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    ),
    check(
      "eligibility_rules_conditional_explanation",
      sql`${table.eligibilityStatus} <> 'CONDITIONAL' or btrim(${table.conditionsText}) <> ''`
    )
  ]
);

export const redemptionTerms = pgTable(
  "redemption_terms",
  {
    ...effectiveRecordColumns(),
    minimumAmount: numeric("minimum_amount", { precision: 38, scale: 18 }),
    minimumAmountAssetId: uuid("minimum_amount_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    noticePeriodHours: numeric("notice_period_hours", { precision: 20, scale: 6 }),
    settlementPeriodHours: numeric("settlement_period_hours", { precision: 20, scale: 6 }),
    windowDescription: text("window_description"),
    gatesPossible: boolean("gates_possible"),
    inKindPossible: boolean("in_kind_possible")
  },
  (table) => [
    unique("redemption_terms_logical_version_unique").on(table.logicalId, table.version),
    index("redemption_terms_target_time_idx").on(
      table.productId,
      table.routeId,
      table.effectiveFrom
    ),
    check("redemption_terms_version_positive", sql`${table.version} > 0`),
    check(
      "redemption_terms_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "redemption_terms_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    ),
    check(
      "redemption_terms_minimum_nonnegative",
      sql`${table.minimumAmount} is null or ${table.minimumAmount} >= 0`
    ),
    check(
      "redemption_terms_amount_unit_pair",
      sql`(${table.minimumAmount} is null) = (${table.minimumAmountAssetId} is null)`
    ),
    check(
      "redemption_terms_periods_nonnegative",
      sql`(${table.noticePeriodHours} is null or ${table.noticePeriodHours} >= 0) and (${table.settlementPeriodHours} is null or ${table.settlementPeriodHours} >= 0)`
    )
  ]
);

export const transferRestrictions = pgTable(
  "transfer_restrictions",
  {
    ...effectiveRecordColumns(),
    transfersAllowed: boolean("transfers_allowed"),
    whitelistRequired: boolean("whitelist_required"),
    description: text("description").notNull()
  },
  (table) => [
    unique("transfer_restrictions_logical_version_unique").on(table.logicalId, table.version),
    index("transfer_restrictions_target_time_idx").on(
      table.productId,
      table.routeId,
      table.effectiveFrom
    ),
    check(
      "transfer_restrictions_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check("transfer_restrictions_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check(
      "transfer_restrictions_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    )
  ]
);

export const custodyRecords = pgTable(
  "custody_records",
  {
    ...effectiveRecordColumns(),
    custodianId: uuid("custodian_id")
      .notNull()
      .references(() => custodians.id, { onDelete: "restrict", onUpdate: "cascade" }),
    custodyType: varchar("custody_type", { length: 64 }).notNull(),
    description: text("description")
  },
  (table) => [
    unique("custody_records_logical_version_unique").on(table.logicalId, table.version),
    index("custody_records_target_time_idx").on(
      table.productId,
      table.routeId,
      table.effectiveFrom
    ),
    check(
      "custody_records_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check("custody_records_type_not_blank", sql`btrim(${table.custodyType}) <> ''`),
    check(
      "custody_records_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    )
  ]
);

export const auditRecords = pgTable(
  "audit_records",
  {
    ...effectiveRecordColumns(),
    auditorId: uuid("auditor_id")
      .notNull()
      .references(() => auditors.id, { onDelete: "restrict", onUpdate: "cascade" }),
    auditType: varchar("audit_type", { length: 64 }).notNull(),
    reportUrl: text("report_url").notNull(),
    periodStart: utcTimestamp("period_start"),
    periodEnd: utcTimestamp("period_end"),
    opinion: text("opinion")
  },
  (table) => [
    unique("audit_records_logical_version_unique").on(table.logicalId, table.version),
    index("audit_records_target_time_idx").on(table.productId, table.routeId, table.effectiveFrom),
    check(
      "audit_records_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check("audit_records_report_https", sql`${table.reportUrl} ~ '^https://'`),
    check(
      "audit_records_period_order",
      sql`${table.periodEnd} is null or (${table.periodStart} is not null and ${table.periodEnd} >= ${table.periodStart})`
    )
  ]
);

export const proofOfReserveRecords = pgTable(
  "proof_of_reserve_records",
  {
    ...effectiveRecordColumns(),
    oracleId: uuid("oracle_id").references(() => oracles.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    reserveRatio: numeric("reserve_ratio", { precision: 24, scale: 18 }),
    attestationUrl: text("attestation_url"),
    description: text("description").notNull()
  },
  (table) => [
    unique("proof_of_reserve_records_logical_version_unique").on(table.logicalId, table.version),
    index("proof_of_reserve_records_target_time_idx").on(
      table.productId,
      table.routeId,
      table.effectiveFrom
    ),
    check(
      "proof_of_reserve_records_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "proof_of_reserve_ratio_nonnegative",
      sql`${table.reserveRatio} is null or ${table.reserveRatio} >= 0`
    ),
    check(
      "proof_of_reserve_attestation_https",
      sql`${table.attestationUrl} is null or ${table.attestationUrl} ~ '^https://'`
    )
  ]
);

export const dataQualityEvents = pgTable(
  "data_quality_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: qualityEventTypeEnum("event_type").notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id"),
    metric: varchar("metric", { length: 96 }),
    primaryObservationId: uuid("primary_observation_id").references(() => sourceObservations.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    competingObservationId: uuid("competing_observation_id").references(
      () => sourceObservations.id,
      { onDelete: "restrict", onUpdate: "cascade" }
    ),
    severity: varchar("severity", { length: 16 }).notNull(),
    details: jsonb("details")
      .notNull()
      .default(sql`'{}'::jsonb`),
    detectedAt: utcTimestamp("detected_at").notNull(),
    resolvedAt: utcTimestamp("resolved_at"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    resolution: text("resolution"),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    index("data_quality_events_open_idx").on(table.resolvedAt, table.severity, table.detectedAt),
    index("data_quality_events_entity_idx").on(table.entityType, table.entityId, table.detectedAt),
    check("data_quality_events_entity_type_not_blank", sql`btrim(${table.entityType}) <> ''`),
    check(
      "data_quality_events_resolution_pair",
      sql`(${table.resolvedAt} is null and ${table.resolution} is null) or (${table.resolvedAt} is not null and btrim(${table.resolution}) <> '')`
    ),
    check(
      "data_quality_events_resolution_order",
      sql`${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.detectedAt}`
    )
  ]
);

export const adapterHealth = pgTable(
  "adapter_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sourceRegistry.id, { onDelete: "restrict", onUpdate: "cascade" }),
    adapterVersion: varchar("adapter_version", { length: 64 }).notNull(),
    outcome: adapterHealthOutcomeEnum("outcome").notNull(),
    attemptedAt: utcTimestamp("attempted_at").notNull(),
    succeededAt: utcTimestamp("succeeded_at"),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    recordsRead: integer("records_read").notNull().default(0),
    recordsAccepted: integer("records_accepted").notNull().default(0),
    recordsRejected: integer("records_rejected").notNull().default(0),
    recordsChanged: integer("records_changed").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    deadLetterCount: integer("dead_letter_count").notNull().default(0),
    freshRecordCount: integer("fresh_record_count").notNull().default(0),
    staleRecordCount: integer("stale_record_count").notNull().default(0),
    errorCategory: varchar("error_category", { length: 96 }),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    index("adapter_health_source_attempt_idx").on(table.sourceId, table.attemptedAt),
    check("adapter_health_duration_nonnegative", sql`${table.durationMs} >= 0`),
    check(
      "adapter_health_counts_nonnegative",
      sql`${table.recordsRead} >= 0 and ${table.recordsAccepted} >= 0 and ${table.recordsRejected} >= 0 and ${table.recordsChanged} >= 0 and ${table.retryCount} >= 0 and ${table.deadLetterCount} >= 0 and ${table.freshRecordCount} >= 0 and ${table.staleRecordCount} >= 0`
    ),
    check(
      "adapter_health_success_timestamp",
      sql`${table.outcome} <> 'SUCCEEDED' or ${table.succeededAt} is not null`
    )
  ]
);

export type SourceObservation = typeof sourceObservations.$inferSelect;
export type NewSourceObservation = typeof sourceObservations.$inferInsert;

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { assets, productCategories, productRoutes, products, yieldSources } from "./catalog.js";
import {
  componentTypeEnum,
  confidenceClassEnum,
  dataStatusEnum,
  feeTypeEnum,
  publicationStatusEnum,
  riskResultStatusEnum
} from "./enums.js";
import { sourceObservations } from "./provenance.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const riskMethodologyVersions = pgTable(
  "risk_methodology_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: varchar("version", { length: 64 }).notNull(),
    publicationStatus: publicationStatusEnum("publication_status").notNull().default("DRAFT"),
    description: text("description").notNull(),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    configuration: jsonb("configuration").notNull(),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    reviewedAt: utcTimestamp("reviewed_at"),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    publishedAt: utcTimestamp("published_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("risk_methodology_versions_version_unique").on(table.version),
    index("risk_methodology_versions_publication_time_idx").on(
      table.publicationStatus,
      table.effectiveFrom
    ),
    check(
      "risk_methodology_versions_configuration_object",
      sql`jsonb_typeof(${table.configuration}) = 'object'`
    ),
    check(
      "risk_methodology_versions_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    ),
    check(
      "risk_methodology_versions_review_pair",
      sql`(${table.reviewedByUserId} is null) = (${table.reviewedAt} is null)`
    ),
    check(
      "risk_methodology_versions_publish_pair",
      sql`(${table.publishedByUserId} is null) = (${table.publishedAt} is null)`
    ),
    check(
      "risk_methodology_versions_published_reviewed",
      sql`${table.publicationStatus} <> 'PUBLISHED' or (${table.reviewedByUserId} is not null and ${table.publishedByUserId} is not null and ${table.reviewedByUserId} <> ${table.publishedByUserId})`
    )
  ]
);

export const riskMethodologyCategoryWeights = pgTable(
  "risk_methodology_category_weights",
  {
    methodologyVersionId: uuid("methodology_version_id")
      .notNull()
      .references(() => riskMethodologyVersions.id, {
        onDelete: "cascade",
        onUpdate: "cascade"
      }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => productCategories.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    factorCode: varchar("factor_code", { length: 96 }).notNull(),
    weight: numeric("weight", { precision: 12, scale: 10 }).notNull(),
    missingEvidencePolicy: jsonb("missing_evidence_policy").notNull(),
    penaltyConfiguration: jsonb("penalty_configuration").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.methodologyVersionId, table.categoryId, table.factorCode],
      name: "risk_methodology_category_weights_pk"
    }),
    check("risk_methodology_weight_range", sql`${table.weight} >= 0 and ${table.weight} <= 1`),
    check("risk_methodology_factor_not_blank", sql`btrim(${table.factorCode}) <> ''`),
    check(
      "risk_methodology_missing_policy_object",
      sql`jsonb_typeof(${table.missingEvidencePolicy}) = 'object'`
    ),
    check(
      "risk_methodology_penalty_config_object",
      sql`jsonb_typeof(${table.penaltyConfiguration}) = 'object'`
    )
  ]
);

const snapshotTargetColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
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
  asOf: utcTimestamp("as_of").notNull(),
  confidence: confidenceClassEnum("confidence").notNull(),
  status: dataStatusEnum("status").notNull(),
  selectionPolicyVersion: varchar("selection_policy_version", { length: 64 }).notNull(),
  createdAt: utcTimestamp("created_at").notNull().defaultNow()
});

export const yieldSnapshots = pgTable(
  "yield_snapshots",
  {
    ...snapshotTargetColumns(),
    baseApy: numeric("base_apy", { precision: 24, scale: 18 }),
    incentiveApy: numeric("incentive_apy", { precision: 24, scale: 18 }),
    grossApy: numeric("gross_apy", { precision: 24, scale: 18 }),
    netApy: numeric("net_apy", { precision: 24, scale: 18 }),
    comparativeRiskAdjustedApy: numeric("comparative_risk_adjusted_apy", {
      precision: 24,
      scale: 18
    }),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    calculationInputs: jsonb("calculation_inputs").notNull(),
    isVariable: boolean("is_variable").notNull(),
    isPromotional: boolean("is_promotional").notNull(),
    promotionEndsAt: utcTimestamp("promotion_ends_at")
  },
  (table) => [
    index("yield_snapshots_route_time_idx").on(table.routeId, table.asOf),
    index("yield_snapshots_product_time_idx").on(table.productId, table.asOf),
    index("yield_snapshots_sortable_idx").on(table.status, table.netApy, table.asOf),
    unique("yield_snapshots_observation_calculation_unique").on(
      table.sourceObservationId,
      table.calculationVersion
    ),
    unique("yield_snapshots_id_route_unique").on(table.id, table.routeId),
    check(
      "yield_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "yield_snapshots_inputs_object",
      sql`jsonb_typeof(${table.calculationInputs}) = 'object'`
    ),
    check(
      "yield_snapshots_available_has_value",
      sql`${table.status} <> 'AVAILABLE' or num_nonnulls(${table.baseApy}, ${table.incentiveApy}, ${table.grossApy}, ${table.netApy}, ${table.comparativeRiskAdjustedApy}) > 0`
    ),
    check(
      "yield_snapshots_unavailable_has_no_value",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls(${table.baseApy}, ${table.incentiveApy}, ${table.grossApy}, ${table.netApy}, ${table.comparativeRiskAdjustedApy}) = 0`
    ),
    check(
      "yield_snapshots_promotion_expiry",
      sql`not ${table.isPromotional} or ${table.promotionEndsAt} is not null`
    )
  ]
);

export const yieldHistoryRollups = pgTable(
  "yield_history_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => productRoutes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    bucketStart: utcTimestamp("bucket_start").notNull(),
    asOf: utcTimestamp("as_of").notNull(),
    sourceYieldSnapshotId: uuid("source_yield_snapshot_id").notNull(),
    netApy: numeric("net_apy", { precision: 24, scale: 18 }).notNull(),
    confidence: confidenceClassEnum("confidence").notNull(),
    status: dataStatusEnum("status").notNull(),
    dataCutoff: utcTimestamp("data_cutoff").notNull(),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("yield_history_rollups_route_bucket_version_unique").on(
      table.routeId,
      table.bucketStart,
      table.calculationVersion
    ),
    index("yield_history_rollups_route_bucket_idx").on(table.routeId, table.bucketStart),
    index("yield_history_rollups_source_snapshot_idx").on(table.sourceYieldSnapshotId),
    foreignKey({
      columns: [table.sourceYieldSnapshotId, table.routeId],
      foreignColumns: [yieldSnapshots.id, yieldSnapshots.routeId],
      name: "yield_history_rollups_snapshot_route_fk"
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "yield_history_rollups_bucket_alignment",
      sql`${table.bucketStart} = date_trunc('day', ${table.bucketStart}, 'UTC')`
    ),
    check(
      "yield_history_rollups_time_order",
      sql`${table.asOf} >= ${table.bucketStart} and ${table.asOf} < ${table.bucketStart} + interval '1 day' and ${table.dataCutoff} >= ${table.bucketStart} + interval '1 day'`
    ),
    check("yield_history_rollups_available", sql`${table.status} = 'AVAILABLE'`)
  ]
);

export const apyComponents = pgTable(
  "apy_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    yieldSnapshotId: uuid("yield_snapshot_id")
      .notNull()
      .references(() => yieldSnapshots.id, { onDelete: "cascade", onUpdate: "cascade" }),
    yieldSourceId: uuid("yield_source_id").references(() => yieldSources.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    sourceObservationId: uuid("source_observation_id").references(() => sourceObservations.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    componentType: componentTypeEnum("component_type").notNull(),
    value: numeric("value", { precision: 24, scale: 18 }),
    unit: varchar("unit", { length: 64 }).notNull(),
    sourcePeriodDays: numeric("source_period_days", { precision: 20, scale: 6 }),
    confidence: confidenceClassEnum("confidence").notNull(),
    status: dataStatusEnum("status").notNull(),
    isVariable: boolean("is_variable").notNull(),
    isPromotional: boolean("is_promotional").notNull(),
    promotionEndsAt: utcTimestamp("promotion_ends_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("apy_components_snapshot_type_source_unique").on(
      table.yieldSnapshotId,
      table.componentType,
      table.yieldSourceId
    ),
    check("apy_components_unit_not_blank", sql`btrim(${table.unit}) <> ''`),
    check(
      "apy_components_period_positive",
      sql`${table.sourcePeriodDays} is null or ${table.sourcePeriodDays} > 0`
    ),
    check(
      "apy_components_available_value",
      sql`${table.status} <> 'AVAILABLE' or ${table.value} is not null`
    ),
    check(
      "apy_components_unavailable_null",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or ${table.value} is null`
    ),
    check(
      "apy_components_promotion_expiry",
      sql`not ${table.isPromotional} or ${table.promotionEndsAt} is not null`
    )
  ]
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    ...snapshotTargetColumns(),
    quoteAssetId: uuid("quote_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    price: numeric("price", { precision: 38, scale: 18 })
  },
  (table) => [
    index("price_snapshots_route_time_idx").on(table.routeId, table.asOf),
    index("price_snapshots_product_time_idx").on(table.productId, table.asOf),
    unique("price_snapshots_observation_quote_unique").on(
      table.sourceObservationId,
      table.quoteAssetId
    ),
    check(
      "price_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "price_snapshots_available_value",
      sql`${table.status} <> 'AVAILABLE' or ${table.price} is not null`
    ),
    check(
      "price_snapshots_unavailable_null",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or ${table.price} is null`
    ),
    check("price_snapshots_nonnegative", sql`${table.price} is null or ${table.price} >= 0`)
  ]
);

export const navSnapshots = pgTable(
  "nav_snapshots",
  {
    ...snapshotTargetColumns(),
    quoteAssetId: uuid("quote_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    navPerToken: numeric("nav_per_token", { precision: 38, scale: 18 }),
    premiumDiscountRatio: numeric("premium_discount_ratio", { precision: 24, scale: 18 })
  },
  (table) => [
    index("nav_snapshots_route_time_idx").on(table.routeId, table.asOf),
    index("nav_snapshots_product_time_idx").on(table.productId, table.asOf),
    unique("nav_snapshots_observation_quote_unique").on(
      table.sourceObservationId,
      table.quoteAssetId
    ),
    check(
      "nav_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "nav_snapshots_available_value",
      sql`${table.status} <> 'AVAILABLE' or ${table.navPerToken} is not null`
    ),
    check(
      "nav_snapshots_unavailable_null",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls(${table.navPerToken}, ${table.premiumDiscountRatio}) = 0`
    ),
    check(
      "nav_snapshots_nonnegative",
      sql`${table.navPerToken} is null or ${table.navPerToken} >= 0`
    )
  ]
);

export const tvlAumSnapshots = pgTable(
  "tvl_aum_snapshots",
  {
    ...snapshotTargetColumns(),
    metricKind: varchar("metric_kind", { length: 8 }).notNull(),
    quoteAssetId: uuid("quote_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    amount: numeric("amount", { precision: 38, scale: 18 })
  },
  (table) => [
    index("tvl_aum_snapshots_route_time_idx").on(table.routeId, table.metricKind, table.asOf),
    index("tvl_aum_snapshots_product_time_idx").on(table.productId, table.metricKind, table.asOf),
    unique("tvl_aum_snapshots_observation_kind_unique").on(
      table.sourceObservationId,
      table.metricKind,
      table.quoteAssetId
    ),
    check("tvl_aum_snapshots_kind", sql`${table.metricKind} in ('TVL', 'AUM')`),
    check(
      "tvl_aum_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "tvl_aum_snapshots_available_value",
      sql`${table.status} <> 'AVAILABLE' or ${table.amount} is not null`
    ),
    check(
      "tvl_aum_snapshots_unavailable_null",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or ${table.amount} is null`
    ),
    check("tvl_aum_snapshots_nonnegative", sql`${table.amount} is null or ${table.amount} >= 0`)
  ]
);

export const liquiditySnapshots = pgTable(
  "liquidity_snapshots",
  {
    ...snapshotTargetColumns(),
    quoteAssetId: uuid("quote_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    immediatelyAvailable: numeric("immediately_available", { precision: 38, scale: 18 }),
    availableWithin24h: numeric("available_within_24h", { precision: 38, scale: 18 }),
    availableWithin7d: numeric("available_within_7d", { precision: 38, scale: 18 }),
    dailyVolume: numeric("daily_volume", { precision: 38, scale: 18 }),
    slippageReferenceAmount: numeric("slippage_reference_amount", { precision: 38, scale: 18 }),
    estimatedSlippageRatio: numeric("estimated_slippage_ratio", { precision: 24, scale: 18 })
  },
  (table) => [
    index("liquidity_snapshots_route_time_idx").on(table.routeId, table.asOf),
    index("liquidity_snapshots_product_time_idx").on(table.productId, table.asOf),
    unique("liquidity_snapshots_observation_quote_unique").on(
      table.sourceObservationId,
      table.quoteAssetId
    ),
    check(
      "liquidity_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "liquidity_snapshots_nonnegative",
      sql`(${table.immediatelyAvailable} is null or ${table.immediatelyAvailable} >= 0) and (${table.availableWithin24h} is null or ${table.availableWithin24h} >= 0) and (${table.availableWithin7d} is null or ${table.availableWithin7d} >= 0) and (${table.dailyVolume} is null or ${table.dailyVolume} >= 0) and (${table.slippageReferenceAmount} is null or ${table.slippageReferenceAmount} >= 0) and (${table.estimatedSlippageRatio} is null or ${table.estimatedSlippageRatio} >= 0)`
    ),
    check(
      "liquidity_snapshots_available_value",
      sql`${table.status} <> 'AVAILABLE' or num_nonnulls(${table.immediatelyAvailable}, ${table.availableWithin24h}, ${table.availableWithin7d}, ${table.dailyVolume}) > 0`
    )
  ]
);

export const utilizationSnapshots = pgTable(
  "utilization_snapshots",
  {
    ...snapshotTargetColumns(),
    utilizationRatio: numeric("utilization_ratio", { precision: 24, scale: 18 })
  },
  (table) => [
    index("utilization_snapshots_route_time_idx").on(table.routeId, table.asOf),
    unique("utilization_snapshots_observation_unique").on(table.sourceObservationId),
    check(
      "utilization_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "utilization_snapshots_range",
      sql`${table.utilizationRatio} is null or (${table.utilizationRatio} >= 0 and ${table.utilizationRatio} <= 1)`
    ),
    check(
      "utilization_snapshots_available_value",
      sql`${table.status} <> 'AVAILABLE' or ${table.utilizationRatio} is not null`
    ),
    check(
      "utilization_snapshots_unavailable_null",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or ${table.utilizationRatio} is null`
    )
  ]
);

export const feeSchedules = pgTable(
  "fee_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalId: uuid("logical_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    feeType: feeTypeEnum("fee_type").notNull(),
    rate: numeric("rate", { precision: 24, scale: 18 }),
    fixedAmount: numeric("fixed_amount", { precision: 38, scale: 18 }),
    fixedAmountAssetId: uuid("fixed_amount_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    unit: varchar("unit", { length: 64 }).notNull(),
    status: dataStatusEnum("status").notNull(),
    confidence: confidenceClassEnum("confidence").notNull(),
    sourceObservationId: uuid("source_observation_id")
      .notNull()
      .references(() => sourceObservations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("fee_schedules_logical_version_unique").on(table.logicalId, table.version),
    index("fee_schedules_target_time_idx").on(table.productId, table.routeId, table.effectiveFrom),
    check("fee_schedules_version_positive", sql`${table.version} > 0`),
    check(
      "fee_schedules_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "fee_schedules_value_shape",
      sql`num_nonnulls(${table.rate}, ${table.fixedAmount}) <= 1 and ((${table.fixedAmount} is null) = (${table.fixedAmountAssetId} is null))`
    ),
    check(
      "fee_schedules_available_value",
      sql`${table.status} <> 'AVAILABLE' or num_nonnulls(${table.rate}, ${table.fixedAmount}) = 1`
    ),
    check(
      "fee_schedules_unavailable_value",
      sql`${table.status} not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls(${table.rate}, ${table.fixedAmount}) = 0`
    ),
    check(
      "fee_schedules_nonnegative",
      sql`(${table.rate} is null or ${table.rate} >= 0) and (${table.fixedAmount} is null or ${table.fixedAmount} >= 0)`
    ),
    check(
      "fee_schedules_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    )
  ]
);

export const riskFactorSnapshots = pgTable(
  "risk_factor_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    methodologyVersionId: uuid("methodology_version_id")
      .notNull()
      .references(() => riskMethodologyVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    factorCode: varchar("factor_code", { length: 96 }).notNull(),
    resultStatus: riskResultStatusEnum("result_status").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }),
    explanation: text("explanation").notNull(),
    inputMetrics: jsonb("input_metrics").notNull(),
    confidence: confidenceClassEnum("confidence").notNull(),
    calculatedAt: utcTimestamp("calculated_at").notNull(),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("risk_factor_snapshots_target_method_time_unique").on(
      table.productId,
      table.routeId,
      table.methodologyVersionId,
      table.factorCode,
      table.calculatedAt
    ),
    index("risk_factor_snapshots_route_time_idx").on(table.routeId, table.calculatedAt),
    index("risk_factor_snapshots_product_time_idx").on(table.productId, table.calculatedAt),
    check(
      "risk_factor_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check("risk_factor_snapshots_factor_not_blank", sql`btrim(${table.factorCode}) <> ''`),
    check(
      "risk_factor_snapshots_score_range",
      sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 100)`
    ),
    check(
      "risk_factor_snapshots_status_score",
      sql`(${table.resultStatus} = 'UNAVAILABLE' and ${table.score} is null) or (${table.resultStatus} <> 'UNAVAILABLE' and ${table.score} is not null)`
    ),
    check(
      "risk_factor_snapshots_inputs_object",
      sql`jsonb_typeof(${table.inputMetrics}) = 'object'`
    )
  ]
);

export const riskFactorEvidence = pgTable(
  "risk_factor_evidence",
  {
    riskFactorSnapshotId: uuid("risk_factor_snapshot_id")
      .notNull()
      .references(() => riskFactorSnapshots.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sourceObservationId: uuid("source_observation_id")
      .notNull()
      .references(() => sourceObservations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.riskFactorSnapshotId, table.sourceObservationId],
      name: "risk_factor_evidence_pk"
    })
  ]
);

export const compositeRiskSnapshots = pgTable(
  "composite_risk_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    methodologyVersionId: uuid("methodology_version_id")
      .notNull()
      .references(() => riskMethodologyVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    resultStatus: riskResultStatusEnum("result_status").notNull(),
    compositeScore: numeric("composite_score", { precision: 5, scale: 2 }),
    coverageRatio: numeric("coverage_ratio", { precision: 24, scale: 18 }).notNull(),
    uncertaintyPenalty: numeric("uncertainty_penalty", { precision: 24, scale: 18 }),
    totalComparativeApyPenalty: numeric("total_comparative_apy_penalty", {
      precision: 24,
      scale: 18
    }),
    explanation: text("explanation").notNull(),
    calculationInputs: jsonb("calculation_inputs").notNull(),
    confidence: confidenceClassEnum("confidence").notNull(),
    calculatedAt: utcTimestamp("calculated_at").notNull(),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("composite_risk_snapshots_target_method_time_unique").on(
      table.productId,
      table.routeId,
      table.methodologyVersionId,
      table.calculatedAt
    ),
    index("composite_risk_snapshots_route_time_idx").on(table.routeId, table.calculatedAt),
    index("composite_risk_snapshots_product_time_idx").on(table.productId, table.calculatedAt),
    check(
      "composite_risk_snapshots_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "composite_risk_snapshots_score_range",
      sql`${table.compositeScore} is null or (${table.compositeScore} >= 0 and ${table.compositeScore} <= 100)`
    ),
    check(
      "composite_risk_snapshots_coverage_range",
      sql`${table.coverageRatio} >= 0 and ${table.coverageRatio} <= 1`
    ),
    check(
      "composite_risk_snapshots_status_score",
      sql`(${table.resultStatus} = 'UNAVAILABLE' and ${table.compositeScore} is null) or (${table.resultStatus} <> 'UNAVAILABLE' and ${table.compositeScore} is not null)`
    ),
    check(
      "composite_risk_snapshots_inputs_object",
      sql`jsonb_typeof(${table.calculationInputs}) = 'object'`
    )
  ]
);

export type YieldSnapshot = typeof yieldSnapshots.$inferSelect;
export type NewYieldSnapshot = typeof yieldSnapshots.$inferInsert;
export type YieldHistoryRollup = typeof yieldHistoryRollups.$inferSelect;
export type NewYieldHistoryRollup = typeof yieldHistoryRollups.$inferInsert;
export type RiskFactorSnapshot = typeof riskFactorSnapshots.$inferSelect;

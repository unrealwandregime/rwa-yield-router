import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
import { assets, chains, jurisdictions, productRoutes, products } from "./catalog.js";
import {
  alertConditionEnum,
  confidenceClassEnum,
  deliveryStatusEnum,
  investorClassificationEnum,
  notificationChannelEnum,
  simulationStatusEnum
} from "./enums.js";
import { riskMethodologyVersions } from "./analytics.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

const encryptedBytes = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
}>({
  dataType: () => "bytea"
});

export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text("name").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("watchlists_user_name_unique").on(table.userId, table.name),
    index("watchlists_user_active_idx").on(table.userId, table.archivedAt),
    check("watchlists_name_not_blank", sql`btrim(${table.name}) <> ''`)
  ]
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade", onUpdate: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("watchlist_items_product_unique").on(table.watchlistId, table.productId),
    unique("watchlist_items_route_unique").on(table.watchlistId, table.routeId),
    check(
      "watchlist_items_exactly_one_target",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    )
  ]
);

export const savedComparisons = pgTable(
  "saved_comparisons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text("name").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("saved_comparisons_user_name_unique").on(table.userId, table.name),
    index("saved_comparisons_user_active_idx").on(table.userId, table.archivedAt),
    check("saved_comparisons_name_not_blank", sql`btrim(${table.name}) <> ''`)
  ]
);

export const savedComparisonItems = pgTable(
  "saved_comparison_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comparisonId: uuid("comparison_id")
      .notNull()
      .references(() => savedComparisons.id, { onDelete: "cascade", onUpdate: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    position: integer("position").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("saved_comparison_items_position_unique").on(table.comparisonId, table.position),
    unique("saved_comparison_items_product_unique").on(table.comparisonId, table.productId),
    unique("saved_comparison_items_route_unique").on(table.comparisonId, table.routeId),
    check(
      "saved_comparison_items_exactly_one_target",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "saved_comparison_items_position_range",
      sql`${table.position} >= 1 and ${table.position} <= 5`
    )
  ]
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    sort: jsonb("sort").notNull(),
    visibleColumns: jsonb("visible_columns").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("saved_views_user_name_unique").on(table.userId, table.name),
    index("saved_views_user_active_idx").on(table.userId, table.archivedAt),
    check("saved_views_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("saved_views_filters_object", sql`jsonb_typeof(${table.filters}) = 'object'`),
    check("saved_views_sort_object", sql`jsonb_typeof(${table.sort}) = 'object'`),
    check("saved_views_visible_columns_array", sql`jsonb_typeof(${table.visibleColumns}) = 'array'`)
  ]
);

export const routeSimulations = pgTable(
  "route_simulations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    isSaved: boolean("is_saved").notNull().default(false),
    name: text("name"),
    capitalAmount: numeric("capital_amount", { precision: 38, scale: 18 }).notNull(),
    capitalAssetId: uuid("capital_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    originChainId: uuid("origin_chain_id").references(() => chains.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    holdingPeriodDays: numeric("holding_period_days", { precision: 20, scale: 6 }).notNull(),
    jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    investorClassification: investorClassificationEnum("investor_classification").notNull(),
    riskProfile: varchar("risk_profile", { length: 32 }).notNull(),
    canonicalConstraints: jsonb("canonical_constraints").notNull(),
    dataCutoff: utcTimestamp("data_cutoff").notNull(),
    methodologyVersionId: uuid("methodology_version_id")
      .notNull()
      .references(() => riskMethodologyVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    solverVersion: varchar("solver_version", { length: 64 }).notNull(),
    calculationVersion: varchar("calculation_version", { length: 64 }).notNull(),
    status: simulationStatusEnum("status").notNull(),
    allocationTotal: numeric("allocation_total", { precision: 20, scale: 18 }),
    grossBlendedApy: numeric("gross_blended_apy", { precision: 24, scale: 18 }),
    netBlendedApy: numeric("net_blended_apy", { precision: 24, scale: 18 }),
    comparativeRiskAdjustedApy: numeric("comparative_risk_adjusted_apy", {
      precision: 24,
      scale: 18
    }),
    weightedRiskScore: numeric("weighted_risk_score", { precision: 5, scale: 2 }),
    dataConfidenceScore: numeric("data_confidence_score", { precision: 5, scale: 2 }),
    resultSummary: jsonb("result_summary"),
    infeasibilityDiagnostics: jsonb("infeasibility_diagnostics"),
    disclosureVersion: varchar("disclosure_version", { length: 64 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    completedAt: utcTimestamp("completed_at"),
    archivedAt: utcTimestamp("archived_at"),
    expiresAt: utcTimestamp("expires_at")
  },
  (table) => [
    index("route_simulations_user_time_idx").on(table.userId, table.createdAt),
    index("route_simulations_status_time_idx").on(table.status, table.createdAt),
    check("route_simulations_capital_positive", sql`${table.capitalAmount} > 0`),
    check("route_simulations_holding_period_positive", sql`${table.holdingPeriodDays} > 0`),
    check(
      "route_simulations_saved_owner",
      sql`not ${table.isSaved} or ${table.userId} is not null`
    ),
    check(
      "route_simulations_constraints_object",
      sql`jsonb_typeof(${table.canonicalConstraints}) = 'object'`
    ),
    check(
      "route_simulations_allocation_total",
      sql`${table.status} <> 'FEASIBLE' or ${table.allocationTotal} = 1.000000000000000000`
    ),
    check(
      "route_simulations_no_infeasible_allocation",
      sql`${table.status} <> 'INFEASIBLE' or ${table.allocationTotal} is null`
    ),
    check(
      "route_simulations_score_ranges",
      sql`(${table.weightedRiskScore} is null or (${table.weightedRiskScore} >= 0 and ${table.weightedRiskScore} <= 100)) and (${table.dataConfidenceScore} is null or (${table.dataConfidenceScore} >= 0 and ${table.dataConfidenceScore} <= 100))`
    ),
    check(
      "route_simulations_completion",
      sql`${table.status} = 'PENDING' or ${table.completedAt} is not null`
    ),
    check(
      "route_simulations_infeasible_diagnostics",
      sql`${table.status} <> 'INFEASIBLE' or jsonb_typeof(${table.infeasibilityDiagnostics}) = 'object'`
    )
  ]
);

export const routeSimulationCandidates = pgTable(
  "route_simulation_candidates",
  {
    simulationId: uuid("simulation_id")
      .notNull()
      .references(() => routeSimulations.id, { onDelete: "cascade", onUpdate: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => productRoutes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    included: boolean("included").notNull(),
    exclusionReasonCode: varchar("exclusion_reason_code", { length: 96 }),
    canonicalFacts: jsonb("canonical_facts").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.simulationId, table.routeId],
      name: "route_simulation_candidates_pk"
    }),
    unique("route_simulation_candidates_ordinal_unique").on(table.simulationId, table.ordinal),
    check("route_simulation_candidates_ordinal_positive", sql`${table.ordinal} > 0`),
    check(
      "route_simulation_candidates_exclusion_reason",
      sql`${table.included} or btrim(${table.exclusionReasonCode}) <> ''`
    ),
    check(
      "route_simulation_candidates_facts_object",
      sql`jsonb_typeof(${table.canonicalFacts}) = 'object'`
    )
  ]
);

export const routeSimulationAllocations = pgTable(
  "route_simulation_allocations",
  {
    simulationId: uuid("simulation_id")
      .notNull()
      .references(() => routeSimulations.id, { onDelete: "cascade", onUpdate: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => productRoutes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    allocationRatio: numeric("allocation_ratio", { precision: 20, scale: 18 }).notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 38, scale: 18 }).notNull(),
    grossApy: numeric("gross_apy", { precision: 24, scale: 18 }),
    netApy: numeric("net_apy", { precision: 24, scale: 18 }),
    comparativeRiskAdjustedApy: numeric("comparative_risk_adjusted_apy", {
      precision: 24,
      scale: 18
    }),
    riskScore: numeric("risk_score", { precision: 5, scale: 2 }),
    rationale: text("rationale").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.simulationId, table.routeId],
      name: "route_simulation_allocations_pk"
    }),
    foreignKey({
      columns: [table.simulationId, table.routeId],
      foreignColumns: [routeSimulationCandidates.simulationId, routeSimulationCandidates.routeId],
      name: "route_simulation_allocations_candidate_fk"
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check(
      "route_simulation_allocations_ratio_range",
      sql`${table.allocationRatio} > 0 and ${table.allocationRatio} <= 1`
    ),
    check("route_simulation_allocations_amount_positive", sql`${table.allocatedAmount} > 0`),
    check(
      "route_simulation_allocations_risk_range",
      sql`${table.riskScore} is null or (${table.riskScore} >= 0 and ${table.riskScore} <= 100)`
    ),
    check("route_simulation_allocations_rationale_not_blank", sql`btrim(${table.rationale}) <> ''`)
  ]
);

export const notificationDestinations = pgTable(
  "notification_destinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    destinationCiphertext: encryptedBytes("destination_ciphertext"),
    destinationHash: varchar("destination_hash", { length: 128 }),
    maskedLabel: text("masked_label").notNull(),
    verifiedAt: utcTimestamp("verified_at"),
    disabledAt: utcTimestamp("disabled_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("notification_destinations_user_hash_unique").on(
      table.userId,
      table.channel,
      table.destinationHash
    ),
    index("notification_destinations_user_active_idx").on(table.userId, table.disabledAt),
    check(
      "notification_destinations_external_value",
      sql`${table.channel} in ('IN_APP', 'CONSOLE') or num_nonnulls(${table.destinationCiphertext}, ${table.destinationHash}) = 2`
    ),
    check("notification_destinations_no_plaintext_label", sql`btrim(${table.maskedLabel}) <> ''`)
  ]
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "cascade",
      onUpdate: "cascade"
    }),
    condition: alertConditionEnum("condition").notNull(),
    threshold: numeric("threshold", { precision: 38, scale: 18 }),
    thresholdUnit: varchar("threshold_unit", { length: 64 }),
    configuration: jsonb("configuration")
      .notNull()
      .default(sql`'{}'::jsonb`),
    minimumConfidence: confidenceClassEnum("minimum_confidence"),
    timezone: text("timezone").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    unsubscribedAt: utcTimestamp("unsubscribed_at"),
    lastEvaluatedAt: utcTimestamp("last_evaluated_at"),
    lastTriggeredAt: utcTimestamp("last_triggered_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    index("alert_rules_user_active_idx").on(table.userId, table.enabled, table.archivedAt),
    index("alert_rules_target_condition_idx").on(table.productId, table.routeId, table.condition),
    check(
      "alert_rules_at_most_one_target",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) <= 1`
    ),
    check(
      "alert_rules_threshold_pair",
      sql`(${table.threshold} is null) = (${table.thresholdUnit} is null)`
    ),
    check("alert_rules_timezone_not_blank", sql`btrim(${table.timezone}) <> ''`),
    check("alert_rules_cooldown_nonnegative", sql`${table.cooldownSeconds} >= 0`),
    check("alert_rules_configuration_object", sql`jsonb_typeof(${table.configuration}) = 'object'`),
    check(
      "alert_rules_unsubscribe_disabled",
      sql`${table.unsubscribedAt} is null or not ${table.enabled}`
    )
  ]
);

export const alertRuleDestinations = pgTable(
  "alert_rule_destinations",
  {
    alertRuleId: uuid("alert_rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade", onUpdate: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => notificationDestinations.id, {
        onDelete: "cascade",
        onUpdate: "cascade"
      }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.alertRuleId, table.destinationId],
      name: "alert_rule_destinations_pk"
    })
  ]
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertRuleId: uuid("alert_rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade", onUpdate: "cascade" }),
    deduplicationKey: varchar("deduplication_key", { length: 128 }).notNull(),
    evaluationVersion: varchar("evaluation_version", { length: 64 }).notNull(),
    observedValue: numeric("observed_value", { precision: 38, scale: 18 }),
    observedUnit: varchar("observed_unit", { length: 64 }),
    payload: jsonb("payload").notNull(),
    triggeredAt: utcTimestamp("triggered_at").notNull(),
    suppressedAt: utcTimestamp("suppressed_at"),
    suppressionReason: text("suppression_reason"),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("alert_events_deduplication_key_unique").on(table.deduplicationKey),
    index("alert_events_rule_time_idx").on(table.alertRuleId, table.triggeredAt),
    check(
      "alert_events_observed_pair",
      sql`(${table.observedValue} is null) = (${table.observedUnit} is null)`
    ),
    check("alert_events_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "alert_events_suppression_pair",
      sql`(${table.suppressedAt} is null and ${table.suppressionReason} is null) or (${table.suppressedAt} is not null and btrim(${table.suppressionReason}) <> '')`
    )
  ]
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertEventId: uuid("alert_event_id")
      .notNull()
      .references(() => alertEvents.id, { onDelete: "cascade", onUpdate: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => notificationDestinations.id, {
        onDelete: "cascade",
        onUpdate: "cascade"
      }),
    channel: notificationChannelEnum("channel").notNull(),
    status: deliveryStatusEnum("status").notNull(),
    providerMessageIdHash: varchar("provider_message_id_hash", { length: 128 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: utcTimestamp("next_attempt_at"),
    lastAttemptAt: utcTimestamp("last_attempt_at"),
    deliveredAt: utcTimestamp("delivered_at"),
    errorCategory: varchar("error_category", { length: 96 }),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("notification_deliveries_event_destination_unique").on(
      table.alertEventId,
      table.destinationId
    ),
    index("notification_deliveries_status_retry_idx").on(table.status, table.nextAttemptAt),
    check("notification_deliveries_attempts_nonnegative", sql`${table.attemptCount} >= 0`),
    check(
      "notification_deliveries_delivered_timestamp",
      sql`${table.status} <> 'DELIVERED' or ${table.deliveredAt} is not null`
    ),
    check(
      "notification_deliveries_expiry_after_create",
      sql`${table.expiresAt} > ${table.createdAt}`
    )
  ]
);

export const linkedWalletAddresses = pgTable(
  "linked_wallet_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "restrict", onUpdate: "cascade" }),
    addressCiphertext: encryptedBytes("address_ciphertext").notNull(),
    addressHash: varchar("address_hash", { length: 128 }).notNull(),
    maskedAddress: text("masked_address").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    deletedAt: utcTimestamp("deleted_at")
  },
  (table) => [
    unique("linked_wallet_addresses_user_chain_hash_unique").on(
      table.userId,
      table.chainId,
      table.addressHash
    ),
    index("linked_wallet_addresses_user_active_idx").on(
      table.userId,
      table.enabled,
      table.deletedAt
    ),
    check("linked_wallet_addresses_mask_not_blank", sql`btrim(${table.maskedAddress}) <> ''`)
  ]
);

export type RouteSimulation = typeof routeSimulations.$inferSelect;
export type NewRouteSimulation = typeof routeSimulations.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;

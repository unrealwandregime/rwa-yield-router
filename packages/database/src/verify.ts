import type { Database } from "./client.js";

const requiredTables = [
  "users",
  "user_profiles",
  "user_preferences",
  "user_preferred_assets",
  "user_preferred_chains",
  "roles",
  "user_roles",
  "sessions",
  "assets",
  "stablecoins",
  "chains",
  "issuers",
  "protocols",
  "custodians",
  "administrators",
  "auditors",
  "oracles",
  "products",
  "product_categories",
  "product_routes",
  "yield_sources",
  "product_yield_sources",
  "contracts",
  "product_contracts",
  "return_exposures",
  "product_return_exposures",
  "source_registry",
  "source_observations",
  "yield_snapshots",
  "yield_history_rollups",
  "apy_components",
  "price_snapshots",
  "nav_snapshots",
  "tvl_aum_snapshots",
  "liquidity_snapshots",
  "utilization_snapshots",
  "risk_factor_snapshots",
  "risk_factor_evidence",
  "composite_risk_snapshots",
  "risk_methodology_versions",
  "risk_methodology_category_weights",
  "fee_schedules",
  "eligibility_rules",
  "jurisdictions",
  "redemption_terms",
  "transfer_restrictions",
  "custody_records",
  "audit_records",
  "proof_of_reserve_records",
  "data_quality_events",
  "adapter_health",
  "job_runs",
  "job_outbox",
  "dead_letter_jobs",
  "watchlists",
  "watchlist_items",
  "saved_comparisons",
  "saved_comparison_items",
  "saved_views",
  "route_simulations",
  "route_simulation_candidates",
  "route_simulation_allocations",
  "notification_destinations",
  "alert_rules",
  "alert_rule_destinations",
  "alert_events",
  "notification_deliveries",
  "linked_wallet_addresses",
  "admin_audit_logs",
  "security_audit_events",
  "data_deletion_receipts",
  "catalog_import_batches",
  "catalog_import_records"
] as const;

const requiredAppendOnlyTriggers = [
  "prevent_catalog_import_batches_mutation",
  "prevent_catalog_import_records_mutation"
] as const;

const requiredRollupConstraints = [
  "yield_history_rollups_bucket_alignment",
  "yield_history_rollups_snapshot_route_fk",
  "yield_history_rollups_time_order",
  "yield_snapshots_id_route_unique"
] as const;

interface NamedRow {
  readonly name: string;
}

interface CountRow {
  readonly count: number;
}

export interface DatabaseVerification {
  readonly valid: boolean;
  readonly checkedTableCount: number;
  readonly issues: readonly string[];
}

export const verifyDatabase = async (database: Database): Promise<DatabaseVerification> => {
  const issues: string[] = [];

  const tableRows = await database.$client<NamedRow[]>`
    select table_name as name
    from information_schema.tables
    where table_schema = 'public'
  `;
  const existingTables = new Set(tableRows.map((row) => row.name));
  for (const table of requiredTables) {
    if (!existingTables.has(table)) {
      issues.push(`Missing required table: ${table}`);
    }
  }

  const nonUtcTimestamps = await database.$client<NamedRow[]>`
    select table_name || '.' || column_name as name
    from information_schema.columns
    where table_schema = 'public'
      and data_type = 'timestamp without time zone'
  `;
  for (const row of nonUtcTimestamps) {
    issues.push(`Timestamp without time zone: ${row.name}`);
  }

  const unsafeFinancialColumns = await database.$client<NamedRow[]>`
    select table_name || '.' || column_name as name
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('real', 'double precision')
      and column_name ~ '(amount|apy|rate|ratio|price|nav|tvl|aum|liquidity|allocation|score|slippage|weight|yield)'
  `;
  for (const row of unsafeFinancialColumns) {
    issues.push(`Binary floating-point financial column: ${row.name}`);
  }

  const foreignKeyCountRows = await database.$client<CountRow[]>`
    select count(*)::integer as count
    from information_schema.table_constraints
    where table_schema = 'public' and constraint_type = 'FOREIGN KEY'
  `;
  if ((foreignKeyCountRows[0]?.count ?? 0) === 0) {
    issues.push("No foreign-key constraints found");
  }

  const appendOnlyTriggers = await database.$client<CountRow[]>`
    select count(*)::integer as count
    from pg_trigger
    where not tgisinternal and tgname like 'prevent_%_mutation'
  `;
  if ((appendOnlyTriggers[0]?.count ?? 0) < 3) {
    issues.push("Append-only mutation guards are missing");
  }
  const appendOnlyTriggerRows = await database.$client<NamedRow[]>`
    select tgname as name
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'prevent_catalog_import_batches_mutation',
        'prevent_catalog_import_records_mutation'
      )
  `;
  const appendOnlyTriggerNames = new Set(appendOnlyTriggerRows.map((row) => row.name));
  for (const triggerName of requiredAppendOnlyTriggers) {
    if (!appendOnlyTriggerNames.has(triggerName)) {
      issues.push(`Missing append-only trigger: ${triggerName}`);
    }
  }
  const rollupConstraintRows = await database.$client<NamedRow[]>`
    select conname as name
    from pg_constraint
    where conname in (
      'yield_history_rollups_bucket_alignment',
      'yield_history_rollups_snapshot_route_fk',
      'yield_history_rollups_time_order',
      'yield_snapshots_id_route_unique'
    )
  `;
  const rollupConstraintNames = new Set(rollupConstraintRows.map((row) => row.name));
  for (const constraintName of requiredRollupConstraints) {
    if (!rollupConstraintNames.has(constraintName)) {
      issues.push(`Missing rollup integrity constraint: ${constraintName}`);
    }
  }
  const rollupTriggerRows = await database.$client<NamedRow[]>`
    select tgname as name
    from pg_trigger
    where not tgisinternal
      and tgname = 'validate_yield_history_rollup_snapshot_fields'
  `;
  if (rollupTriggerRows.length !== 1) {
    issues.push("Missing rollup source-snapshot consistency trigger");
  }

  return {
    valid: issues.length === 0,
    checkedTableCount: requiredTables.length,
    issues
  };
};

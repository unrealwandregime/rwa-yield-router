import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema/index.js";

const requiredTableNames = [
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

const requiredTables = [
  schema.users,
  schema.userProfiles,
  schema.userPreferences,
  schema.userPreferredAssets,
  schema.userPreferredChains,
  schema.roles,
  schema.userRoles,
  schema.sessions,
  schema.assets,
  schema.stablecoins,
  schema.chains,
  schema.issuers,
  schema.protocols,
  schema.custodians,
  schema.administrators,
  schema.auditors,
  schema.oracles,
  schema.products,
  schema.productCategories,
  schema.productRoutes,
  schema.yieldSources,
  schema.productYieldSources,
  schema.contracts,
  schema.productContracts,
  schema.returnExposures,
  schema.productReturnExposures,
  schema.sourceRegistry,
  schema.sourceObservations,
  schema.yieldSnapshots,
  schema.yieldHistoryRollups,
  schema.apyComponents,
  schema.priceSnapshots,
  schema.navSnapshots,
  schema.tvlAumSnapshots,
  schema.liquiditySnapshots,
  schema.utilizationSnapshots,
  schema.riskFactorSnapshots,
  schema.riskFactorEvidence,
  schema.compositeRiskSnapshots,
  schema.riskMethodologyVersions,
  schema.riskMethodologyCategoryWeights,
  schema.feeSchedules,
  schema.eligibilityRules,
  schema.jurisdictions,
  schema.redemptionTerms,
  schema.transferRestrictions,
  schema.custodyRecords,
  schema.auditRecords,
  schema.proofOfReserveRecords,
  schema.dataQualityEvents,
  schema.adapterHealth,
  schema.jobRuns,
  schema.jobOutbox,
  schema.deadLetterJobs,
  schema.watchlists,
  schema.watchlistItems,
  schema.savedComparisons,
  schema.savedComparisonItems,
  schema.savedViews,
  schema.routeSimulations,
  schema.routeSimulationCandidates,
  schema.routeSimulationAllocations,
  schema.notificationDestinations,
  schema.alertRules,
  schema.alertRuleDestinations,
  schema.alertEvents,
  schema.notificationDeliveries,
  schema.linkedWalletAddresses,
  schema.adminAuditLogs,
  schema.securityAuditEvents,
  schema.dataDeletionReceipts,
  schema.catalogImportBatches,
  schema.catalogImportRecords
] as const;

const schemaTableNames = requiredTables.map((table) => getTableName(table));

describe("database schema contract", () => {
  it("contains every required normalized table", () => {
    expect(schemaTableNames).toEqual(expect.arrayContaining([...requiredTableNames]));
    expect(new Set(schemaTableNames).size).toBe(requiredTableNames.length);
  });

  it("uses exact NUMERIC scales for authoritative rates and amounts", () => {
    const yieldColumns = getTableConfig(schema.yieldSnapshots).columns;
    expect(yieldColumns.find((column) => column.name === "gross_apy")?.getSQLType()).toBe(
      "numeric(24, 18)"
    );

    const simulationColumns = getTableConfig(schema.routeSimulations).columns;
    expect(simulationColumns.find((column) => column.name === "capital_amount")?.getSQLType()).toBe(
      "numeric(38, 18)"
    );
    expect(
      simulationColumns.find((column) => column.name === "allocation_total")?.getSQLType()
    ).toBe("numeric(20, 18)");
  });

  it("stores economic and audit timestamps with timezone", () => {
    const observationColumns = getTableConfig(schema.sourceObservations).columns;
    expect(observationColumns.find((column) => column.name === "observed_at")?.getSQLType()).toBe(
      "timestamp with time zone"
    );

    const auditColumns = getTableConfig(schema.adminAuditLogs).columns;
    expect(auditColumns.find((column) => column.name === "occurred_at")?.getSQLType()).toBe(
      "timestamp with time zone"
    );
  });

  it("defines stable public slugs and provenance idempotency", () => {
    const productConfig = getTableConfig(schema.products);
    const routeConfig = getTableConfig(schema.productRoutes);
    const observationConfig = getTableConfig(schema.sourceObservations);

    expect(productConfig.columns.find((column) => column.name === "slug")?.notNull).toBe(true);
    expect(routeConfig.columns.find((column) => column.name === "slug")?.notNull).toBe(true);
    expect(
      observationConfig.uniqueConstraints.some(
        (constraint) => constraint.getName() === "source_observations_idempotency_key_unique"
      )
    ).toBe(true);
  });

  it("links each daily yield rollup to its selected source snapshot", () => {
    const rollupConfig = getTableConfig(schema.yieldHistoryRollups);
    const snapshotRouteForeignKey = rollupConfig.foreignKeys.find(
      (foreignKey) => foreignKey.getName() === "yield_history_rollups_snapshot_route_fk"
    );

    expect(snapshotRouteForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      "source_yield_snapshot_id",
      "route_id"
    ]);
    expect(
      snapshotRouteForeignKey?.reference().foreignColumns.map((column) => column.name)
    ).toEqual(["id", "route_id"]);
    expect(
      rollupConfig.uniqueConstraints.some(
        (constraint) => constraint.getName() === "yield_history_rollups_route_bucket_version_unique"
      )
    ).toBe(true);
  });

  it("keeps user-owned tables anchored to an owner foreign key", () => {
    for (const table of [
      schema.watchlists,
      schema.savedComparisons,
      schema.savedViews,
      schema.alertRules
    ]) {
      const config = getTableConfig(table);
      expect(config.columns.some((column) => column.name === "user_id")).toBe(true);
      expect(
        config.foreignKeys.some((foreignKey) =>
          foreignKey
            .reference()
            .foreignColumns.some((column) => getTableName(column.table) === "users")
        )
      ).toBe(true);
    }
  });
});

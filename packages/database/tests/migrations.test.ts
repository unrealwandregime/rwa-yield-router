import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../migrations/", import.meta.url);

const readMigration = async (name: string): Promise<string> =>
  readFile(new URL(name, migrationsDirectory), "utf8");

describe("checked migrations", () => {
  it("creates every material table with decimal-safe and UTC storage", async () => {
    const migration = await readMigration("0000_numerous_doorman.sql");

    for (const tableName of [
      "products",
      "product_routes",
      "source_observations",
      "yield_snapshots",
      "risk_factor_snapshots",
      "route_simulations",
      "admin_audit_logs"
    ]) {
      expect(migration).toContain(`CREATE TABLE \"${tableName}\"`);
    }

    expect(migration).toContain("numeric(38, 18)");
    expect(migration).toContain("numeric(24, 18)");
    expect(migration).toContain("timestamp with time zone");
    expect(migration).not.toMatch(/\b(double precision|real)\b/i);
  });

  it("hardens append-only evidence, published methods, jobs, and simulations", async () => {
    const migration = await readMigration("0001_integrity_hardening.sql");

    expect(migration).toContain("prevent_append_only_mutation");
    expect(migration).toContain("protect_published_record");
    expect(migration).toContain("validate_methodology_publication");
    expect(migration).toContain("validate_simulation_finalization");
    expect(migration).toContain("enforce_job_status_transition");
  });

  it("adds lowercase-safe public product and route slugs", async () => {
    const migration = await readMigration("0002_public_slugs.sql");

    expect(migration).toContain('ADD COLUMN "slug" varchar(128) NOT NULL');
    expect(migration).toContain("products_slug_unique");
    expect(migration).toContain("product_routes_slug_unique");
    expect(migration).toContain("^[a-z0-9]+(-[a-z0-9]+)*$");
  });

  it("keeps current slugs unique while allowing stable slugs across versions", async () => {
    const migration = await readMigration("0003_relationship_integrity.sql");

    expect(migration).toContain("products_current_slug_unique");
    expect(migration).toContain("product_routes_current_slug_unique");
    expect(migration).toContain("products_slug_version_unique");
    expect(migration).toContain("product_routes_slug_version_unique");
    expect(migration).toContain('WHERE "products"."effective_to" is null');
    expect(migration).toContain('WHERE "product_routes"."effective_to" is null');
  });

  it("creates composite candidate and route-product integrity in dependency order", async () => {
    const migration = await readMigration("0004_composite_relationships.sql");
    const referencedKey = migration.indexOf("product_routes_id_product_unique");
    const dependentForeignKey = migration.indexOf("product_contracts_route_product_fk");

    expect(referencedKey).toBeGreaterThanOrEqual(0);
    expect(dependentForeignKey).toBeGreaterThan(referencedKey);
    expect(migration).toContain("route_simulation_allocations_candidate_fk");
  });

  it("tracks production catalog imports without weakening publication admission", async () => {
    const migration = await readMigration("0005_production_catalog_import.sql");

    expect(migration).toContain('CREATE TABLE "catalog_import_batches"');
    expect(migration).toContain('CREATE TABLE "catalog_import_records"');
    expect(migration).toContain("catalog_import_batches_payload_hash_unique");
    expect(migration).toContain("catalog_import_records_publication_semantics");
    expect(migration).toContain("catalog_import_records_admission_gate");
    expect(migration).toContain("catalog_import_records_warnings_array");
  });

  it("stores bounded daily history rollups with source-snapshot provenance", async () => {
    const migration = await readMigration("0006_equal_shen.sql");
    const utcIntegrity = await readMigration("0007_big_drax.sql");
    const routeIntegrity = await readMigration("0008_naive_bloodstrike.sql");
    const snapshotConsistency = await readMigration("0010_rollup_snapshot_consistency.sql");

    expect(migration).toContain('CREATE TABLE "yield_history_rollups"');
    expect(migration).toContain("yield_history_rollups_route_bucket_version_unique");
    expect(migration).toContain("yield_history_rollups_source_yield_snapshot_id_yield_snapshots");
    expect(migration).toContain("yield_history_rollups_bucket_alignment");
    expect(migration).toContain("yield_history_rollups_time_order");
    expect(utcIntegrity).toContain("yield_snapshots_id_route_unique");
    expect(utcIntegrity).toContain(
      "date_trunc('day', \"yield_history_rollups\".\"bucket_start\", 'UTC')"
    );
    expect(routeIntegrity).toContain("yield_history_rollups_snapshot_route_fk");
    expect(snapshotConsistency).toContain("validate_yield_history_rollup_snapshot_fields");
    expect(snapshotConsistency).toContain("must exactly match its source yield snapshot");
  });

  it("makes the reviewed catalog import audit append-only", async () => {
    const migration = await readMigration("0009_catalog_import_append_only.sql");

    expect(migration).toContain("prevent_catalog_import_batches_mutation");
    expect(migration).toContain("prevent_catalog_import_records_mutation");
    expect(migration).toContain("prevent_append_only_mutation");
  });

  it("registers all migrations in order", async () => {
    const journalPath = new URL("meta/_journal.json", migrationsDirectory);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      readonly entries: ReadonlyArray<{ readonly idx: number; readonly tag: string }>;
    };

    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: "0000_numerous_doorman" },
      { idx: 1, tag: "0001_integrity_hardening" },
      { idx: 2, tag: "0002_public_slugs" },
      { idx: 3, tag: "0003_relationship_integrity" },
      { idx: 4, tag: "0004_composite_relationships" },
      { idx: 5, tag: "0005_production_catalog_import" },
      { idx: 6, tag: "0006_equal_shen" },
      { idx: 7, tag: "0007_big_drax" },
      { idx: 8, tag: "0008_naive_bloodstrike" },
      { idx: 9, tag: "0009_catalog_import_append_only" },
      { idx: 10, tag: "0010_rollup_snapshot_consistency" }
    ]);
    expect(fileURLToPath(journalPath)).toContain("migrations");
  });
});

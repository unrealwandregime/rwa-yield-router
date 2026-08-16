import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { productionCatalog, type ProductionCatalogRecord } from "@rwa-yield-router/data-adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeDatabase, createDatabase, type Database } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";
import { importProductionCatalog } from "../src/production-catalog-import.js";
import { seedCanonicalReferenceData } from "../src/seed.js";
import {
  products,
  sourceObservations,
  sourceRegistry,
  yieldHistoryRollups,
  yieldSnapshots
} from "../src/schema/index.js";
import { verifyDatabase } from "../src/verify.js";

const integrationDatabaseUrl = process.env.DATABASE_INTEGRATION_URL;
if (integrationDatabaseUrl === undefined) {
  throw new Error(
    "DATABASE_INTEGRATION_URL is required for the explicitly integration-tagged database suite"
  );
}

const databaseName = new URL(integrationDatabaseUrl).pathname.slice(1);
if (!databaseName.toLocaleLowerCase("en-US").includes("test")) {
  throw new Error("DATABASE_INTEGRATION_URL must identify a dedicated test database");
}

let database: Database;

const migrationJournalSchema = z
  .object({
    dialect: z.string(),
    entries: z.array(
      z
        .object({
          breakpoints: z.boolean(),
          idx: z.number().int().nonnegative(),
          tag: z.string(),
          version: z.string(),
          when: z.number()
        })
        .passthrough()
    ),
    version: z.string()
  })
  .passthrough();

const migrateFromLatestReleasedSchema = async (target: Database): Promise<void> => {
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  const stagedFolder = await mkdtemp(join(tmpdir(), "rwa-yield-router-migrations-"));
  try {
    await mkdir(join(stagedFolder, "meta"));
    const names = (await readdir(migrationsFolder)).filter((name) =>
      /^000[0-5]_.+\.sql$/u.test(name)
    );
    for (const name of names) {
      await copyFile(join(migrationsFolder, name), join(stagedFolder, name));
    }
    const journal = migrationJournalSchema.parse(
      JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"))
    );
    await writeFile(
      join(stagedFolder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 5) })
    );
    await runMigrations(target, stagedFolder);
    const [beforeUpgrade] = await target.$client<
      Array<{ readonly import_table: string | null; readonly rollup_table: string | null }>
    >`
      select to_regclass('public.catalog_import_batches')::text as import_table,
             to_regclass('public.yield_history_rollups')::text as rollup_table
    `;
    expect(beforeUpgrade).toEqual({
      import_table: "catalog_import_batches",
      rollup_table: null
    });
    await runMigrations(target);
  } finally {
    await rm(stagedFolder, { force: true, recursive: true });
  }
};

const errorChainText = (value: unknown): string => {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n");
};

const ORIGINAL_CATALOG_CUTOFF = "2026-07-13T00:00:00.000Z";

const originalCatalogRecord = (record: ProductionCatalogRecord): ProductionCatalogRecord => {
  const original = {
    ...record,
    sourceVerifiedAt: ORIGINAL_CATALOG_CUTOFF,
    verifiedAt: ORIGINAL_CATALOG_CUTOFF
  };
  if (["DL-01", "DL-02", "DL-03", "DL-04", "DL-05", "DL-06"].includes(record.id)) {
    return {
      ...original,
      ...(record.id === "DL-01"
        ? {
            publicationStatus: "GATED" as const,
            status: "SOURCE_CONFIRMED" as const,
            warnings: ["This discovery record is gated and is not an available route."]
          }
        : {}),
      source: {
        id: "AAVE",
        name: "Aave official address book",
        type: "OFFICIAL_DOCUMENT",
        url: "https://github.com/bgd-labs/aave-address-book"
      }
    };
  }
  if (record.id === "MM-06") {
    return {
      ...original,
      publicationStatus: "GATED",
      source: {
        id: "USYC",
        name: "Circle USYC",
        type: "OFFICIAL_DOCUMENT",
        url: "https://www.circle.com/usyc"
      },
      status: "SOURCE_CONFIRMED",
      warnings: ["This discovery record is gated and is not an available route."]
    };
  }
  if (record.id === "CE-01") {
    return {
      ...original,
      chain: "Multi-chain",
      publicationStatus: "GATED",
      routeName: "USDC base-asset hold",
      source: {
        id: "CIRCLE",
        name: "Circle stablecoins",
        type: "OFFICIAL_DOCUMENT",
        url: "https://www.circle.com/usdc"
      },
      status: "SOURCE_CONFIRMED",
      warnings: [
        "This discovery record is gated and is not an available route.",
        "Issuer reserve income is not native holder yield."
      ]
    };
  }
  return original;
};

describe("database migrations against an isolated PostgreSQL database", () => {
  beforeAll(async () => {
    database = createDatabase({
      connectionString: integrationDatabaseUrl,
      maxConnections: 1
    });
    const [existing] = await database.$client<{ readonly name: string | null }[]>`
      select to_regclass('public.products')::text as name
    `;
    if (existing?.name !== null) {
      throw new Error("Integration database must start empty; refusing to modify existing tables");
    }
    await migrateFromLatestReleasedSchema(database);
    await seedCanonicalReferenceData(database);
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it("applies the complete schema and canonical non-market seeds", async () => {
    const verification = await verifyDatabase(database);
    expect(verification).toEqual({
      checkedTableCount: 73,
      issues: [],
      valid: true
    });

    const productCountRows = await database.$client<
      Array<{ readonly count: number }>
    >`select count(*)::integer as count from products`;
    expect(productCountRows[0]?.count).toBe(0);
  });

  it("publishes the canonical methodology after its 96 weights and remains idempotent", async () => {
    await seedCanonicalReferenceData(database);
    const methodologyRows = await database.$client<
      Array<{
        readonly publication_status: string;
        readonly published_by_user_id: string | null;
        readonly reviewed_by_user_id: string | null;
      }>
    >`
      select publication_status::text,
             published_by_user_id::text,
             reviewed_by_user_id::text
      from risk_methodology_versions
      where version = '1.0.0'
    `;
    expect(methodologyRows).toHaveLength(1);
    expect(methodologyRows[0]?.publication_status).toBe("PUBLISHED");
    expect(methodologyRows[0]?.reviewed_by_user_id).not.toBeNull();
    expect(methodologyRows[0]?.published_by_user_id).not.toBeNull();
    expect(methodologyRows[0]?.published_by_user_id).not.toBe(
      methodologyRows[0]?.reviewed_by_user_id
    );

    const rows = await database.$client<
      Array<{ readonly category: string; readonly count: number; readonly total: string }>
    >`
      select pc.code::text as category,
             count(*)::integer as count,
             sum(w.weight)::text as total
      from risk_methodology_category_weights w
      join risk_methodology_versions m on m.id = w.methodology_version_id
      join product_categories pc on pc.id = w.category_id
      where m.version = '1.0.0'
      group by pc.code
      order by pc.code
    `;
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.count === 16 && row.total === "1.0000000000")).toBe(true);
  });

  it("enforces append-only source observations", async () => {
    const [source] = await database
      .insert(sourceRegistry)
      .values({
        canonicalUrl: "https://fixture.example.test/api",
        code: "INTEGRATION_FIXTURE",
        name: "Integration fixture source",
        ownerName: "Test suite",
        priority: 100,
        rateLimitPolicy: {},
        removalProcedure: "Delete only with the isolated integration database.",
        sourceType: "OFFICIAL_API"
      })
      .returning();
    if (source === undefined) {
      throw new Error("Fixture source insert returned no row");
    }

    const [observation] = await database
      .insert(sourceObservations)
      .values({
        adapterVersion: "test-only-v1",
        confidence: "DIRECT_API",
        correlationId: "00000000-0000-4000-8000-000000000001",
        entityType: "TEST_FIXTURE",
        externalEntityId: "fixture-1",
        fetchedAt: new Date("2026-01-01T00:00:01.000Z"),
        idempotencyKey: "test-observation-1",
        metric: "TEST_VALUE",
        normalizedNumericValue: "0",
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        provenanceHash: "test-provenance-1",
        sourceId: source.id,
        sourceRevision: "fixture-revision-1",
        status: "AVAILABLE",
        unit: "DECIMAL_RATIO",
        valueType: "NUMERIC"
      })
      .returning();
    if (observation === undefined) {
      throw new Error("Fixture observation insert returned no row");
    }

    let mutationError: unknown;
    try {
      await database.execute(
        sql`update source_observations set normalized_numeric_value = 1 where id = ${observation.id}`
      );
    } catch (error) {
      mutationError = error;
    }

    expect(mutationError).toBeInstanceOf(Error);
    expect(errorChainText(mutationError)).toMatch(/append-only/i);
  });

  it("upgrades a mixed-cutoff catalog without reverifying unchanged route identities", async () => {
    const originalCatalog = productionCatalog.map(originalCatalogRecord);
    const original = await importProductionCatalog(database, { records: originalCatalog });
    expect(original).toMatchObject({
      gatedRecords: 37,
      outcome: "IMPORTED",
      publishedRecords: 23,
      recordsImported: 60
    });

    const current = await importProductionCatalog(database);
    expect(current).toMatchObject({
      gatedRecords: 34,
      outcome: "IMPORTED",
      publishedRecords: 26,
      recordsImported: 60
    });

    const versionRows = await database.$client<
      Array<{ readonly count: number; readonly slug: string }>
    >`
      select slug, count(*)::integer as count
      from products
      where slug in (
        'aave-v3-usdc-ethereum',
        'aave-v3-usdt-ethereum',
        'circle-usyc-ethereum',
        'usdc-base-asset'
      )
      group by slug
      order by slug
    `;
    expect(versionRows).toEqual([
      { count: 2, slug: "aave-v3-usdc-ethereum" },
      { count: 1, slug: "aave-v3-usdt-ethereum" },
      { count: 2, slug: "circle-usyc-ethereum" },
      { count: 2, slug: "usdc-base-asset" }
    ]);

    const aaveSourceRows = await database.$client<
      Array<{ readonly reviewed_at: string; readonly version: number }>
    >`
      select reviewed_at::text, version
      from source_registry
      where code = 'CATALOG-AAVE'
      order by version
    `;
    expect(aaveSourceRows).toHaveLength(2);
    expect(aaveSourceRows[1]?.reviewed_at).toContain("2026-07-18");

    expect(await importProductionCatalog(database)).toMatchObject({
      outcome: "DUPLICATE",
      recordsImported: 0
    });
  });

  it("rejects updates and deletes against the catalog import audit", async () => {
    let batchMutationError: unknown;
    let recordMutationError: unknown;
    try {
      await database.execute(sql`
        update catalog_import_batches
        set imported_at = imported_at
        where id = (select id from catalog_import_batches order by imported_at desc limit 1)
      `);
    } catch (error) {
      batchMutationError = error;
    }
    try {
      await database.execute(sql`
        delete from catalog_import_records
        where id = (select id from catalog_import_records limit 1)
      `);
    } catch (error) {
      recordMutationError = error;
    }

    expect(errorChainText(batchMutationError)).toMatch(/append-only/iu);
    expect(errorChainText(recordMutationError)).toMatch(/append-only/iu);
  });

  it("enforces UTC rollup buckets and route-matched source snapshots in a non-UTC session", async () => {
    const routes = await database.$client<Array<{ readonly id: string; readonly slug: string }>>`
      select id::text, slug
      from product_routes
      where effective_to is null
      order by slug
      limit 2
    `;
    const firstRoute = routes[0];
    const secondRoute = routes[1];
    if (firstRoute === undefined || secondRoute === undefined)
      throw new Error("Catalog routes were not imported");
    const [source] = await database.select({ id: sourceRegistry.id }).from(sourceRegistry).limit(1);
    if (source === undefined) throw new Error("Catalog sources were not imported");

    const observations = await database
      .insert(sourceObservations)
      .values(
        [firstRoute, secondRoute].map((route, index) => ({
          adapterVersion: "rollup-integrity-test-v1",
          confidence: "DIRECT_API" as const,
          correlationId: `00000000-0000-4000-8000-00000000001${index}`,
          entityType: "ROUTE",
          externalEntityId: route.slug,
          fetchedAt: new Date("2026-07-18T12:00:01.000Z"),
          idempotencyKey: `rollup-integrity-${index}`,
          metric: "YIELD",
          normalizedNumericValue: "4.2",
          observedAt: new Date("2026-07-18T12:00:00.000Z"),
          provenanceHash: `rollup-integrity-hash-${index}`,
          sourceId: source.id,
          sourceRevision: "integration-fixture",
          status: "AVAILABLE" as const,
          unit: "PERCENTAGE_POINTS",
          valueType: "NUMERIC" as const
        }))
      )
      .returning({ id: sourceObservations.id });
    const firstObservation = observations[0];
    const secondObservation = observations[1];
    if (firstObservation === undefined || secondObservation === undefined)
      throw new Error("Rollup observations were not inserted");
    const routeObservations = [
      { observation: firstObservation, route: firstRoute },
      { observation: secondObservation, route: secondRoute }
    ] as const;
    const snapshots = await database
      .insert(yieldSnapshots)
      .values(
        routeObservations.map(({ observation, route }, index) => ({
          asOf: new Date("2026-07-18T12:00:00.000Z"),
          baseApy: "4.2",
          calculationInputs: { integrationFixture: true },
          calculationVersion: `rollup-integrity-${index}`,
          confidence: "DIRECT_API" as const,
          grossApy: "4.2",
          isPromotional: false,
          isVariable: true,
          netApy: "4.2",
          routeId: route.id,
          selectionPolicyVersion: "integration-fixture-v1",
          sourceObservationId: observation.id,
          status: "AVAILABLE" as const
        }))
      )
      .returning({ id: yieldSnapshots.id });
    const firstSnapshot = snapshots[0];
    const secondSnapshot = snapshots[1];
    if (firstSnapshot === undefined || secondSnapshot === undefined)
      throw new Error("Rollup snapshots were not inserted");

    await database.execute(sql`set time zone 'Asia/Kolkata'`);
    try {
      await database.insert(yieldHistoryRollups).values({
        asOf: new Date("2026-07-18T12:00:00.000Z"),
        bucketStart: new Date("2026-07-18T00:00:00.000Z"),
        calculationVersion: "rollup-integrity-valid",
        confidence: "DIRECT_API",
        dataCutoff: new Date("2026-07-19T00:00:00.000Z"),
        netApy: "4.2",
        routeId: firstRoute.id,
        sourceYieldSnapshotId: firstSnapshot.id,
        status: "AVAILABLE"
      });

      await expect(
        database.insert(yieldHistoryRollups).values({
          asOf: new Date("2026-07-18T12:00:00.000Z"),
          bucketStart: new Date("2026-07-17T18:30:00.000Z"),
          calculationVersion: "rollup-integrity-local-midnight",
          confidence: "DIRECT_API",
          dataCutoff: new Date("2026-07-19T00:00:00.000Z"),
          netApy: "4.2",
          routeId: firstRoute.id,
          sourceYieldSnapshotId: firstSnapshot.id,
          status: "AVAILABLE"
        })
      ).rejects.toThrow();

      const mismatchedValue = database.insert(yieldHistoryRollups).values({
        asOf: new Date("2026-07-18T12:00:00.000Z"),
        bucketStart: new Date("2026-07-18T00:00:00.000Z"),
        calculationVersion: "rollup-integrity-mismatched-value",
        confidence: "DIRECT_API",
        dataCutoff: new Date("2026-07-19T00:00:00.000Z"),
        netApy: "9.9",
        routeId: firstRoute.id,
        sourceYieldSnapshotId: firstSnapshot.id,
        status: "AVAILABLE"
      });
      await expect(mismatchedValue).rejects.toThrow();
      const mismatchedValueRows = await database
        .select({ id: yieldHistoryRollups.id })
        .from(yieldHistoryRollups)
        .where(
          sql`${yieldHistoryRollups.calculationVersion} = 'rollup-integrity-mismatched-value'`
        );
      expect(mismatchedValueRows).toHaveLength(0);

      await expect(
        database.insert(yieldHistoryRollups).values({
          asOf: new Date("2026-07-18T12:00:00.000Z"),
          bucketStart: new Date("2026-07-18T00:00:00.000Z"),
          calculationVersion: "rollup-integrity-wrong-route",
          confidence: "DIRECT_API",
          dataCutoff: new Date("2026-07-19T00:00:00.000Z"),
          netApy: "4.2",
          routeId: firstRoute.id,
          sourceYieldSnapshotId: secondSnapshot.id,
          status: "AVAILABLE"
        })
      ).rejects.toThrow();
    } finally {
      await database.execute(sql`set time zone 'UTC'`);
    }
  });

  it("fails closed instead of reusing a drifted current catalog entity", async () => {
    await database
      .update(products)
      .set({ lifecycleStatus: "PAUSED" })
      .where(sql`${products.slug} = 'ondo-ousg-ethereum' and ${products.effectiveTo} is null`);
    await expect(importProductionCatalog(database)).rejects.toThrow(/drifted after its reviewed/u);
    const batchCount = await database.$client<Array<{ readonly count: number }>>`
      select count(*)::integer as count from catalog_import_batches
    `;
    expect(batchCount[0]?.count).toBe(2);
  });
});

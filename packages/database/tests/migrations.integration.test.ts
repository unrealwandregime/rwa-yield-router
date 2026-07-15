import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type Database } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";
import { seedCanonicalReferenceData } from "../src/seed.js";
import { sourceObservations, sourceRegistry } from "../src/schema/index.js";
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
    await runMigrations(database);
    await seedCanonicalReferenceData(database);
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it("applies the complete schema and canonical non-market seeds", async () => {
    const verification = await verifyDatabase(database);
    expect(verification).toEqual({
      checkedTableCount: 72,
      issues: [],
      valid: true
    });

    const productCountRows = await database.$client<
      Array<{ readonly count: number }>
    >`select count(*)::integer as count from products`;
    expect(productCountRows[0]?.count).toBe(0);
  });

  it("seeds the immutable 96-row methodology weight set idempotently", async () => {
    await seedCanonicalReferenceData(database);
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

    await expect(
      database.execute(
        sql`update source_observations set normalized_numeric_value = 1 where id = ${observation.id}`
      )
    ).rejects.toThrow(/append-only/i);
  });
});

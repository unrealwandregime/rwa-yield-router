import { validateProductionCatalog } from "@rwa-yield-router/data-adapters";
import { describe, expect, it, vi } from "vitest";

import {
  catalogBootstrapExpectation,
  collectReadiness,
  evaluateDatabaseBootstrap,
  summarizeCatalogCoverage
} from "@/lib/readiness";

const catalogReport = validateProductionCatalog();
const bootstrapExpectation = catalogBootstrapExpectation(catalogReport);

describe("web readiness", () => {
  it("reports complete admission coverage without conflating it with service readiness", async () => {
    const result = await collectReadiness({
      catalogReport,
      databaseConfigured: true,
      databaseRequired: true,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      probeDatabase: vi.fn(async () => ({
        bootstrap: "ready" as const,
        compatible: true,
        healthy: true
      })),
      probeRateLimitStore: vi.fn(async () => true),
      rateLimitStoreConfigured: true
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("ready");
    expect(result.body.releaseStatus).toBe("ready");
    expect(result.body.dependencies.catalogAdmission).toBe("ready");
    expect(result.body.catalogCoverage).toMatchObject({
      admittedCategories: 6,
      admittedRecords: 26,
      gatedRecords: 34,
      requiredCategories: 6,
      researchedCategories: 6,
      researchedRecords: 60
    });
  });

  it("fails readiness when the configured database has not imported the current catalog", async () => {
    const result = await collectReadiness({
      catalogReport,
      databaseConfigured: true,
      databaseRequired: true,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      probeDatabase: vi.fn(async () => ({
        bootstrap: "not_initialized" as const,
        compatible: true,
        healthy: true
      })),
      probeRateLimitStore: vi.fn(async () => true),
      rateLimitStoreConfigured: true
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("not_ready");
    expect(result.body.dependencies.database).toBe("ready");
    expect(result.body.dependencies.databaseBootstrap).toBe("not_initialized");
  });

  it("requires exact researched, admitted, and gated counts for database bootstrap", () => {
    const matchingBatch = {
      catalogSchemaVersion: "1.0.0",
      draftCount: 0,
      gatedCount: 34,
      payloadSha256: bootstrapExpectation.payloadSha256,
      publishedCount: 26,
      recordCount: 60
    };

    expect(evaluateDatabaseBootstrap(matchingBatch, bootstrapExpectation)).toBe("ready");
    expect(
      evaluateDatabaseBootstrap({ ...matchingBatch, publishedCount: 60 }, bootstrapExpectation)
    ).toBe("catalog_mismatch");
    expect(
      evaluateDatabaseBootstrap(
        { ...matchingBatch, payloadSha256: "0".repeat(64) },
        bootstrapExpectation
      )
    ).toBe("catalog_mismatch");
    expect(evaluateDatabaseBootstrap(null, bootstrapExpectation)).toBe("not_initialized");
    expect(summarizeCatalogCoverage(catalogReport).categories.DEFI_LENDING).toEqual({
      admitted: 1,
      gated: 9,
      researched: 10
    });
  });
});

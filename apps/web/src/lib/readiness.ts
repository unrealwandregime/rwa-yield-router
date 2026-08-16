import { buildProductionCatalogImportPlan } from "@rwa-yield-router/database";
import type { CatalogValidationReport } from "@rwa-yield-router/data-adapters";

export type DatabaseBootstrapState =
  "ready" | "not_initialized" | "catalog_mismatch" | "unavailable";

export interface DatabaseReadiness {
  readonly compatible: boolean;
  readonly healthy: boolean;
  readonly bootstrap: DatabaseBootstrapState;
}

export interface CatalogBootstrapExpectation {
  readonly researched: number;
  readonly admitted: number;
  readonly gated: number;
  readonly payloadSha256: string;
}

export interface CatalogImportBatchSummary {
  readonly catalogSchemaVersion: string;
  readonly draftCount: number;
  readonly gatedCount: number;
  readonly publishedCount: number;
  readonly payloadSha256: string;
  readonly recordCount: number;
}

export interface ReadinessDependencies {
  readonly catalogReport: CatalogValidationReport | null;
  readonly databaseConfigured: boolean;
  readonly databaseRequired: boolean;
  readonly now: () => Date;
  readonly probeDatabase: () => Promise<DatabaseReadiness>;
  readonly probeRateLimitStore: () => Promise<boolean>;
  readonly rateLimitStoreConfigured: boolean;
}

const REQUIRED_CATEGORY_COUNT = 6;

export const catalogBootstrapExpectation = (
  report: CatalogValidationReport
): CatalogBootstrapExpectation => ({
  admitted: report.admitted,
  gated: report.gated,
  payloadSha256: buildProductionCatalogImportPlan().payloadSha256,
  researched: report.researched
});

export const evaluateDatabaseBootstrap = (
  batch: CatalogImportBatchSummary | null,
  expected: CatalogBootstrapExpectation
): DatabaseBootstrapState => {
  if (batch === null) return "not_initialized";
  return batch.catalogSchemaVersion === "1.0.0" &&
    batch.draftCount === 0 &&
    batch.payloadSha256 === expected.payloadSha256 &&
    batch.recordCount === expected.researched &&
    batch.publishedCount === expected.admitted &&
    batch.gatedCount === expected.gated
    ? "ready"
    : "catalog_mismatch";
};

export const summarizeCatalogCoverage = (report: CatalogValidationReport) => {
  const coverage = Object.values(report.categoryCoverage);
  return {
    admittedCategories: coverage.filter((category) => category.admitted > 0).length,
    admittedRecords: report.admitted,
    categories: report.categoryCoverage,
    gatedRecords: report.gated,
    requiredCategories: REQUIRED_CATEGORY_COUNT,
    researchedCategories: coverage.filter((category) => category.researched > 0).length,
    researchedRecords: report.researched
  };
};

export async function collectReadiness(dependencies: ReadinessDependencies) {
  const [databaseState, rateLimitStoreHealthy] = await Promise.all([
    dependencies.databaseConfigured
      ? dependencies
          .probeDatabase()
          .catch(() => ({ bootstrap: "unavailable", compatible: false, healthy: false }) as const)
      : Promise.resolve({ bootstrap: "unavailable", compatible: false, healthy: false } as const),
    dependencies.probeRateLimitStore().catch(() => false)
  ]);
  const catalogCoverage =
    dependencies.catalogReport === null
      ? null
      : summarizeCatalogCoverage(dependencies.catalogReport);
  const admissionCoverageComplete =
    catalogCoverage?.admittedCategories === catalogCoverage?.requiredCategories;
  const databaseReady = dependencies.databaseConfigured
    ? databaseState.healthy && databaseState.compatible
    : !dependencies.databaseRequired;
  const databaseBootstrapReady = dependencies.databaseConfigured
    ? databaseState.bootstrap === "ready"
    : !dependencies.databaseRequired;
  const ready =
    dependencies.catalogReport !== null &&
    databaseReady &&
    databaseBootstrapReady &&
    rateLimitStoreHealthy;
  const dependenciesStatus = {
    catalog: dependencies.catalogReport === null ? "invalid" : "ready",
    catalogAdmission:
      dependencies.catalogReport === null
        ? "invalid"
        : admissionCoverageComplete
          ? "ready"
          : "incomplete",
    database: dependencies.databaseConfigured
      ? databaseState.healthy
        ? databaseState.compatible
          ? "ready"
          : "schema_incompatible"
        : "unavailable"
      : dependencies.databaseRequired
        ? "not_configured"
        : "optional_in_development",
    databaseBootstrap: dependencies.databaseConfigured
      ? databaseState.bootstrap
      : dependencies.databaseRequired
        ? "not_configured"
        : "optional_in_development",
    rateLimitStore: rateLimitStoreHealthy
      ? "ready"
      : dependencies.rateLimitStoreConfigured
        ? "unavailable"
        : dependencies.databaseRequired
          ? "not_configured"
          : "optional_in_development"
  };
  return {
    body: {
      catalogCoverage,
      dependencies: dependenciesStatus,
      releaseStatus: ready && admissionCoverageComplete ? "ready" : "incomplete",
      status: ready ? "ready" : "not_ready",
      timestamp: dependencies.now().toISOString()
    },
    httpStatus: ready ? 200 : 503
  } as const;
}

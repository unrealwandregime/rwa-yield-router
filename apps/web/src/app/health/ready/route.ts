import { getServerConfig } from "@rwa-yield-router/config";
import {
  catalogImportBatches,
  checkDatabaseHealth,
  getDatabase,
  verifyDatabase
} from "@rwa-yield-router/database";
import {
  validateProductionCatalog,
  type CatalogValidationReport
} from "@rwa-yield-router/data-adapters";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { checkRateLimitStoreHealth } from "@/lib/api";
import {
  catalogBootstrapExpectation,
  collectReadiness,
  evaluateDatabaseBootstrap,
  type CatalogBootstrapExpectation,
  type DatabaseReadiness
} from "@/lib/readiness";

let databaseReadinessCache: Readonly<{ expiresAt: number; value: DatabaseReadiness }> | undefined;
let databaseReadinessInFlight: Promise<DatabaseReadiness> | undefined;

const databaseReadiness = async (
  expected: CatalogBootstrapExpectation
): Promise<DatabaseReadiness> => {
  const now = Date.now();
  if (databaseReadinessCache && databaseReadinessCache.expiresAt > now)
    return databaseReadinessCache.value;
  databaseReadinessInFlight ??= (async () => {
    try {
      const database = getDatabase({ connectTimeoutSeconds: 3 });
      const health = await checkDatabaseHealth(database);
      if (!health.healthy)
        return { bootstrap: "unavailable", compatible: false, healthy: false } as const;

      const verification = await verifyDatabase(database);
      if (!verification.valid)
        return { bootstrap: "unavailable", compatible: false, healthy: true } as const;

      const [latestImport] = await database
        .select({
          catalogSchemaVersion: catalogImportBatches.catalogSchemaVersion,
          draftCount: catalogImportBatches.draftCount,
          gatedCount: catalogImportBatches.gatedCount,
          publishedCount: catalogImportBatches.publishedCount,
          payloadSha256: catalogImportBatches.payloadSha256,
          recordCount: catalogImportBatches.recordCount
        })
        .from(catalogImportBatches)
        .where(eq(catalogImportBatches.catalogName, "production-catalog"))
        .orderBy(desc(catalogImportBatches.importedAt))
        .limit(1);
      return {
        bootstrap: evaluateDatabaseBootstrap(latestImport ?? null, expected),
        compatible: true,
        healthy: true
      } as const;
    } catch {
      return { bootstrap: "unavailable", compatible: false, healthy: false } as const;
    }
  })().finally(() => {
    databaseReadinessInFlight = undefined;
  });
  const value = await databaseReadinessInFlight;
  databaseReadinessCache = {
    expiresAt:
      now + (value.healthy && value.compatible && value.bootstrap === "ready" ? 10_000 : 5_000),
    value
  };
  return value;
};

export async function GET() {
  const config = getServerConfig();
  const databaseRequired = config.nodeEnv === "production";
  const databaseConfigured = config.databaseUrl !== undefined;
  let catalogReport: CatalogValidationReport | null = null;
  try {
    catalogReport = validateProductionCatalog();
  } catch {
    catalogReport = null;
  }
  const expected =
    catalogReport === null
      ? { admitted: 0, gated: 0, payloadSha256: "", researched: 0 }
      : catalogBootstrapExpectation(catalogReport);
  const result = await collectReadiness({
    catalogReport,
    databaseConfigured,
    databaseRequired,
    now: () => new Date(),
    probeDatabase: () => databaseReadiness(expected),
    probeRateLimitStore: checkRateLimitStoreHealth,
    rateLimitStoreConfigured: config.redisUrl !== undefined
  });
  return NextResponse.json(result.body, {
    headers: { "cache-control": "no-store" },
    status: result.httpStatus
  });
}

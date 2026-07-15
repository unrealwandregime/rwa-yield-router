import { NextResponse } from "next/server";
import { checkDatabaseHealth, getDatabase, verifyDatabase } from "@rwa-yield-router/database";
import { validateProductionCatalog } from "@rwa-yield-router/data-adapters";
import { checkRateLimitStoreHealth } from "@/lib/api";

type DatabaseReadiness = Readonly<{ compatible: boolean; healthy: boolean }>;
let databaseReadinessCache: Readonly<{ expiresAt: number; value: DatabaseReadiness }> | undefined;

const databaseReadiness = async (): Promise<DatabaseReadiness> => {
  const now = Date.now();
  if (databaseReadinessCache && databaseReadinessCache.expiresAt > now)
    return databaseReadinessCache.value;
  try {
    const database = getDatabase({ connectTimeoutSeconds: 3 });
    const health = await checkDatabaseHealth(database);
    const verification = health.healthy ? await verifyDatabase(database) : null;
    const value = { compatible: verification?.valid ?? false, healthy: health.healthy };
    databaseReadinessCache = { expiresAt: now + 60_000, value };
    return value;
  } catch {
    return { compatible: false, healthy: false };
  }
};

export async function GET() {
  const databaseRequired = process.env.NODE_ENV === "production";
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const [databaseState, rateLimitStoreHealthy] = await Promise.all([
    databaseConfigured
      ? databaseReadiness()
      : Promise.resolve({ compatible: !databaseRequired, healthy: !databaseRequired }),
    checkRateLimitStoreHealth()
  ]);
  let catalogReady = false;
  try {
    catalogReady = validateProductionCatalog().total >= 60;
  } catch {
    catalogReady = false;
  }
  const dependencies = {
    catalog: catalogReady ? "ready" : "invalid",
    database: databaseConfigured
      ? databaseState.healthy
        ? databaseState.compatible
          ? "ready"
          : "schema_incompatible"
        : "unavailable"
      : databaseRequired
        ? "not_configured"
        : "optional_in_development",
    rateLimitStore: rateLimitStoreHealthy
      ? "ready"
      : process.env.REDIS_URL
        ? "unavailable"
        : databaseRequired
          ? "not_configured"
          : "optional_in_development"
  };
  const ready =
    catalogReady && databaseState.healthy && databaseState.compatible && rateLimitStoreHealthy;
  return NextResponse.json(
    { dependencies, status: ready ? "ready" : "not_ready", timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" }, status: ready ? 200 : 503 }
  );
}

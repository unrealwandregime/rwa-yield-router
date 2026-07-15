import "server-only";

import { getServerConfig } from "@rwa-yield-router/config";
import {
  adapterHealth,
  checkDatabaseHealth,
  getDatabase,
  jobRuns,
  sourceRegistry,
  verifyDatabase
} from "@rwa-yield-router/database";
import { desc, eq } from "drizzle-orm";

import { checkRateLimitStoreHealth } from "@/lib/api";

const STATUS_CACHE_MS = 15_000;
const STATUS_TIMEOUT_MS = 4_000;
const MAX_PUBLIC_COUNT = 1_000_000_000;
const SAFE_CODE = /^[A-Z][A-Z0-9_-]{0,63}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u;
const JOB_NAMES = new Set([
  "DELIVER_NOTIFICATION",
  "EVALUATE_ALERTS",
  "INGEST_SOURCE",
  "RECALCULATE_RISK",
  "ROLLUP_HISTORY"
]);
const JOB_STATUSES = new Set([
  "CANCELLED",
  "DEAD_LETTERED",
  "FAILED",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED"
]);
const ADAPTER_OUTCOMES = new Set(["DEGRADED", "FAILED", "SUCCEEDED"]);

export type DependencyState = "HEALTHY" | "NOT_CONFIGURED" | "UNAVAILABLE";
export type SchemaState = "COMPATIBLE" | "INCOMPATIBLE" | "NOT_CONFIGURED" | "UNAVAILABLE";

export interface RawJobActivity {
  readonly jobName: string;
  readonly status: string;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly retryCount: number;
  readonly deadLetterCount: number;
  readonly staleRecordCount: number;
  readonly errorCategory: string | null;
}

export interface RawAdapterActivity {
  readonly providerCode: string;
  readonly adapterVersion: string;
  readonly outcome: string;
  readonly attemptedAt: Date;
  readonly succeededAt: Date | null;
  readonly durationMs: number;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly retryCount: number;
  readonly deadLetterCount: number;
  readonly staleRecordCount: number;
  readonly errorCategory: string | null;
}

export interface RawDatabaseStatus {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly schemaCompatible: boolean | null;
  readonly latestJob: RawJobActivity | null;
  readonly latestAdapter: RawAdapterActivity | null;
}

export interface OperationalStatusDependencies {
  readonly databaseConfigured: boolean;
  readonly redisConfigured: boolean;
  readonly now: () => Date;
  readonly probeDatabase: () => Promise<RawDatabaseStatus>;
  readonly probeRateLimitStore: () => Promise<boolean>;
}

export interface JobActivity {
  readonly jobName: string;
  readonly status: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly retryCount: number;
  readonly deadLetterCount: number;
  readonly staleRecordCount: number;
  readonly errorCategory: string | null;
}

export interface AdapterActivity {
  readonly providerCode: string;
  readonly adapterVersion: string;
  readonly outcome: string;
  readonly attemptedAt: string;
  readonly succeededAt: string | null;
  readonly durationMs: number;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly retryCount: number;
  readonly deadLetterCount: number;
  readonly staleRecordCount: number;
  readonly errorCategory: string | null;
}

export interface OperationalStatus {
  readonly checkedAt: string;
  readonly database: Readonly<{ latencyMs: number | null; state: DependencyState }>;
  readonly schema: Readonly<{ state: SchemaState }>;
  readonly rateLimitStore: Readonly<{ state: DependencyState }>;
  readonly latestJob: JobActivity | null;
  readonly latestAdapter: AdapterActivity | null;
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), MAX_PUBLIC_COUNT);
}

function isoTimestamp(value: Date | null): string | null {
  if (value === null || !Number.isFinite(value.getTime())) return null;
  return value.toISOString();
}

function publicCode(value: string | null): string | null {
  if (value === null) return null;
  return SAFE_CODE.test(value) ? value : "REDACTED_FAILURE";
}

function sanitizeJob(value: RawJobActivity | null): JobActivity | null {
  if (value === null) return null;
  return {
    jobName: JOB_NAMES.has(value.jobName) ? value.jobName : "OTHER_JOB",
    status: JOB_STATUSES.has(value.status) ? value.status : "UNKNOWN",
    queuedAt: isoTimestamp(value.queuedAt) ?? "unavailable",
    startedAt: isoTimestamp(value.startedAt),
    completedAt: isoTimestamp(value.completedAt),
    recordsAccepted: boundedCount(value.recordsAccepted),
    recordsRejected: boundedCount(value.recordsRejected),
    recordsChanged: boundedCount(value.recordsChanged),
    retryCount: boundedCount(value.retryCount),
    deadLetterCount: boundedCount(value.deadLetterCount),
    staleRecordCount: boundedCount(value.staleRecordCount),
    errorCategory: publicCode(value.errorCategory)
  };
}

function sanitizeAdapter(value: RawAdapterActivity | null): AdapterActivity | null {
  if (value === null) return null;
  return {
    providerCode: SAFE_CODE.test(value.providerCode) ? value.providerCode : "OFFICIAL_PROVIDER",
    adapterVersion: SAFE_VERSION.test(value.adapterVersion) ? value.adapterVersion : "unavailable",
    outcome: ADAPTER_OUTCOMES.has(value.outcome) ? value.outcome : "UNKNOWN",
    attemptedAt: isoTimestamp(value.attemptedAt) ?? "unavailable",
    succeededAt: isoTimestamp(value.succeededAt),
    durationMs: Math.min(boundedCount(value.durationMs), 86_400_000),
    recordsAccepted: boundedCount(value.recordsAccepted),
    recordsRejected: boundedCount(value.recordsRejected),
    recordsChanged: boundedCount(value.recordsChanged),
    retryCount: boundedCount(value.retryCount),
    deadLetterCount: boundedCount(value.deadLetterCount),
    staleRecordCount: boundedCount(value.staleRecordCount),
    errorCategory: publicCode(value.errorCategory)
  };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.catch(() => null),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function collectOperationalStatus(
  dependencies: OperationalStatusDependencies,
  timeoutMs = STATUS_TIMEOUT_MS
): Promise<OperationalStatus> {
  const boundedTimeout = Math.min(Math.max(timeoutMs, 25), 10_000);
  const [databaseResult, rateLimitResult] = await Promise.all([
    dependencies.databaseConfigured
      ? withTimeout(dependencies.probeDatabase(), boundedTimeout)
      : Promise.resolve(null),
    dependencies.redisConfigured
      ? withTimeout(dependencies.probeRateLimitStore(), boundedTimeout)
      : Promise.resolve(null)
  ]);

  const databaseState: DependencyState = !dependencies.databaseConfigured
    ? "NOT_CONFIGURED"
    : databaseResult?.healthy
      ? "HEALTHY"
      : "UNAVAILABLE";
  const schemaState: SchemaState = !dependencies.databaseConfigured
    ? "NOT_CONFIGURED"
    : !databaseResult?.healthy || databaseResult.schemaCompatible === null
      ? "UNAVAILABLE"
      : databaseResult.schemaCompatible
        ? "COMPATIBLE"
        : "INCOMPATIBLE";
  const rateLimitState: DependencyState = !dependencies.redisConfigured
    ? "NOT_CONFIGURED"
    : rateLimitResult
      ? "HEALTHY"
      : "UNAVAILABLE";

  return {
    checkedAt: dependencies.now().toISOString(),
    database: {
      latencyMs: databaseResult?.healthy
        ? Math.min(Math.max(Math.round(databaseResult.latencyMs), 0), 60_000)
        : null,
      state: databaseState
    },
    schema: { state: schemaState },
    rateLimitStore: { state: rateLimitState },
    latestJob: databaseResult?.healthy ? sanitizeJob(databaseResult.latestJob) : null,
    latestAdapter: databaseResult?.healthy ? sanitizeAdapter(databaseResult.latestAdapter) : null
  };
}

async function queryDatabaseStatus(connectionString: string): Promise<RawDatabaseStatus> {
  const database = getDatabase({
    connectTimeoutSeconds: 3,
    connectionString,
    maxConnections: 4
  });
  const health = await checkDatabaseHealth(database);
  if (!health.healthy)
    return {
      healthy: false,
      latencyMs: health.latencyMs,
      latestAdapter: null,
      latestJob: null,
      schemaCompatible: null
    };

  const [verification, activity] = await Promise.all([
    verifyDatabase(database).catch(() => null),
    Promise.all([
      database
        .select({
          completedAt: jobRuns.completedAt,
          deadLetterCount: jobRuns.deadLetterCount,
          errorCategory: jobRuns.errorCategory,
          jobName: jobRuns.jobName,
          queuedAt: jobRuns.queuedAt,
          recordsAccepted: jobRuns.recordsAccepted,
          recordsChanged: jobRuns.recordsChanged,
          recordsRejected: jobRuns.recordsRejected,
          retryCount: jobRuns.retryCount,
          staleRecordCount: jobRuns.staleRecordCount,
          startedAt: jobRuns.startedAt,
          status: jobRuns.status
        })
        .from(jobRuns)
        .orderBy(desc(jobRuns.queuedAt))
        .limit(1),
      database
        .select({
          adapterVersion: adapterHealth.adapterVersion,
          attemptedAt: adapterHealth.attemptedAt,
          deadLetterCount: adapterHealth.deadLetterCount,
          durationMs: adapterHealth.durationMs,
          errorCategory: adapterHealth.errorCategory,
          outcome: adapterHealth.outcome,
          providerCode: sourceRegistry.code,
          recordsAccepted: adapterHealth.recordsAccepted,
          recordsChanged: adapterHealth.recordsChanged,
          recordsRejected: adapterHealth.recordsRejected,
          retryCount: adapterHealth.retryCount,
          staleRecordCount: adapterHealth.staleRecordCount,
          succeededAt: adapterHealth.succeededAt
        })
        .from(adapterHealth)
        .innerJoin(sourceRegistry, eq(adapterHealth.sourceId, sourceRegistry.id))
        .orderBy(desc(adapterHealth.attemptedAt))
        .limit(1)
    ]).catch(() => null)
  ]);

  return {
    healthy: true,
    latencyMs: health.latencyMs,
    latestAdapter: activity?.[1][0] ?? null,
    latestJob: activity?.[0][0] ?? null,
    schemaCompatible: verification?.valid ?? null
  };
}

function defaultDependencies(): OperationalStatusDependencies {
  let databaseUrl: string | undefined;
  let redisConfigured = false;
  try {
    const config = getServerConfig();
    databaseUrl = config.databaseUrl;
    redisConfigured = config.redisUrl !== undefined;
  } catch {
    databaseUrl = undefined;
  }
  return {
    databaseConfigured: databaseUrl !== undefined,
    redisConfigured,
    now: () => new Date(),
    probeDatabase: () =>
      databaseUrl === undefined
        ? Promise.reject(new Error("Database is not configured"))
        : queryDatabaseStatus(databaseUrl),
    probeRateLimitStore: checkRateLimitStoreHealth
  };
}

let cachedStatus: Readonly<{ expiresAt: number; promise: Promise<OperationalStatus> }> | undefined;

export function getOperationalStatus(): Promise<OperationalStatus> {
  const now = Date.now();
  if (cachedStatus !== undefined && cachedStatus.expiresAt > now) return cachedStatus.promise;
  const promise = collectOperationalStatus(defaultDependencies());
  cachedStatus = { expiresAt: now + STATUS_CACHE_MS, promise };
  return promise;
}

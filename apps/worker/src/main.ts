import { once } from "node:events";

import { getWorkerServerConfig } from "@rwa-yield-router/config";
import {
  checkDatabaseHealth,
  closeDatabase,
  createDatabase,
  verifyDatabase
} from "@rwa-yield-router/database";
import { MorphoGraphqlAdapter } from "@rwa-yield-router/data-adapters";
import {
  ConsoleEmailAdapter,
  NotificationDispatcher,
  ResendEmailAdapter,
  TelegramAdapter,
  type NotificationAdapter
} from "@rwa-yield-router/notifications";
import {
  createConfiguredErrorReporter,
  createInMemoryMetrics,
  createStructuredLogger
} from "@rwa-yield-router/observability";

import { createDatabaseJobRunStore } from "./database-job-store.js";
import { createProductionWorkerHandlers } from "./handlers.js";
import { startHealthServer } from "./health.js";
import { startOutboxPump, type OutboxPump } from "./outbox.js";
import { createWorkerRuntime } from "./runtime.js";
import { createDefaultSchedules } from "./schedules.js";

const config = getWorkerServerConfig();
const logger = createStructuredLogger({
  environment: config.nodeEnv,
  minimumLevel: config.logLevel,
  service: "rwa-yield-router-worker"
});
const errorReporter = createConfiguredErrorReporter({
  environment: config.nodeEnv,
  logger,
  service: "rwa-yield-router-worker",
  ...config.observability
});

if (!config.worker.enabled) {
  logger.error("worker.disabled", { code: "WORKER_ENABLED_FALSE" });
  void errorReporter.capture(new Error("Worker is disabled"), { code: "WORKER_ENABLED_FALSE" });
  process.exitCode = 1;
} else if (config.databaseUrl === undefined || config.redisUrl === undefined) {
  logger.error("worker.configuration_missing", {
    databaseConfigured: config.databaseUrl !== undefined,
    redisConfigured: config.redisUrl !== undefined
  });
  void errorReporter.capture(new Error("Worker configuration is incomplete"), {
    code: "WORKER_CONFIGURATION_MISSING",
    databaseConfigured: config.databaseUrl !== undefined,
    redisConfigured: config.redisUrl !== undefined
  });
  process.exitCode = 1;
} else {
  const database = createDatabase({ connectionString: config.databaseUrl });
  const metrics = createInMemoryMetrics();
  let runtime: Awaited<ReturnType<typeof createWorkerRuntime>> | null = null;
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | null = null;
  let outboxPump: OutboxPump | null = null;
  let shuttingDown = false;
  let schemaReadinessCache: Readonly<{ compatible: boolean; expiresAt: number }> | undefined;

  const schemaCompatible = async (): Promise<boolean> => {
    const currentTime = Date.now();
    if (schemaReadinessCache && schemaReadinessCache.expiresAt > currentTime)
      return schemaReadinessCache.compatible;
    try {
      const compatible = (await verifyDatabase(database)).valid;
      schemaReadinessCache = { compatible, expiresAt: currentTime + 60_000 };
      return compatible;
    } catch {
      return false;
    }
  };

  const bounded = async (operation: Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        })
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker.shutdown_started", { signal });
    if (healthServer !== null) {
      healthServer.close();
      await once(healthServer, "close");
    }
    outboxPump?.stop();
    if (runtime !== null) await runtime.close();
    await closeDatabase(database);
    logger.info("worker.shutdown_completed", { signal });
  };

  try {
    const morphoAdapter = new MorphoGraphqlAdapter({ endpoint: config.morphoApiUrl });
    const notificationAdapters: NotificationAdapter[] = [];
    if (config.email.transport === "console" && config.nodeEnv !== "production") {
      notificationAdapters.push(new ConsoleEmailAdapter(logger));
    } else if (config.email.transport === "resend") {
      notificationAdapters.push(
        new ResendEmailAdapter({
          apiKey: config.email.resendApiKey,
          from: config.email.from
        })
      );
    }
    notificationAdapters.push(new TelegramAdapter({ botToken: config.telegram.botToken }));
    const notificationDispatcher = new NotificationDispatcher(notificationAdapters);
    runtime = await createWorkerRuntime({
      concurrency: config.worker.concurrency,
      drainDelaySeconds: config.worker.drainDelaySeconds,
      handlers: createProductionWorkerHandlers({
        database,
        encryptionKey: config.dataEncryptionKey,
        morphoAdapter,
        notificationDispatcher
      }),
      errorReporter,
      jobRunStore: createDatabaseJobRunStore(database, {
        adapterVersions: { [morphoAdapter.id]: morphoAdapter.version }
      }),
      logger,
      metrics,
      redisUrl: config.redisUrl,
      schedules: config.worker.schedules.enabled
        ? createDefaultSchedules({
            intervals: {
              alertMs: config.worker.schedules.alertIntervalMs,
              ingestMs: config.worker.schedules.ingestIntervalMs,
              riskMs: config.worker.schedules.riskIntervalMs,
              rollupMs: config.worker.schedules.rollupIntervalMs
            }
          })
        : []
    });
    const activeRuntime = runtime;
    outboxPump = startOutboxPump(database, activeRuntime, logger);
    healthServer = await startHealthServer({
      errorReporter,
      logger,
      metrics: () => metrics.snapshot(),
      ...(config.cronSharedSecret === undefined ? {} : { metricsToken: config.cronSharedSecret }),
      port: config.worker.port,
      ready: async () => {
        const [databaseHealth, schemaReady, queueReady] = await Promise.all([
          checkDatabaseHealth(database),
          schemaCompatible(),
          bounded(activeRuntime.ready(), 3_500)
        ]);
        return databaseHealth.healthy && schemaReady && queueReady;
      }
    });
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    logger.info("worker.started", {
      concurrency: config.worker.concurrency,
      port: config.worker.port
    });
  } catch {
    logger.error("worker.startup_failed", { code: "STARTUP_FAILURE" });
    await errorReporter.capture(new Error("Worker startup failed"), {
      code: "STARTUP_FAILURE"
    });
    await shutdown("STARTUP_FAILURE");
    process.exitCode = 1;
  }
}

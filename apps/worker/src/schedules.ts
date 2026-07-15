import { createIdempotencyKey } from "@rwa-yield-router/data-adapters";
import { createCorrelationId } from "@rwa-yield-router/observability";

import type { WorkerJob } from "./jobs.js";

export interface WorkerSchedule {
  readonly schedulerId: string;
  readonly everyMs: number;
  readonly job: WorkerJob;
}

export interface ScheduleOptions {
  readonly morphoSourceId?: string;
  readonly now?: () => Date;
  readonly correlationId?: () => string;
  readonly intervals?: Readonly<{
    alertMs: number;
    ingestMs: number;
    riskMs: number;
    rollupMs: number;
  }>;
}

export function createDefaultSchedules(
  options: ScheduleOptions = {}
): ReadonlyArray<WorkerSchedule> {
  const now = options.now ?? (() => new Date());
  const correlationId = options.correlationId ?? createCorrelationId;
  const morphoSourceId = options.morphoSourceId ?? "MORPHO-API";
  const instant = now().toISOString();
  const intervals = options.intervals ?? {
    alertMs: 5 * 60_000,
    ingestMs: 15 * 60_000,
    riskMs: 60 * 60_000,
    rollupMs: 24 * 60 * 60_000
  };

  return [
    {
      everyMs: intervals.ingestMs,
      job: {
        correlationId: correlationId(),
        externalEntityId: null,
        idempotencyKey: createIdempotencyKey("schedule:ingest", {
          sourceId: morphoSourceId,
          intervalMs: intervals.ingestMs
        }),
        name: "INGEST_SOURCE",
        sourceId: morphoSourceId,
        version: 1
      },
      schedulerId: "ingest:" + morphoSourceId
    },
    {
      everyMs: intervals.riskMs,
      job: {
        correlationId: correlationId(),
        dataCutoff: instant,
        idempotencyKey: createIdempotencyKey("schedule:risk", { intervalMs: intervals.riskMs }),
        name: "RECALCULATE_RISK",
        routeId: null,
        version: 1
      },
      schedulerId: "risk:hourly"
    },
    {
      everyMs: intervals.alertMs,
      job: {
        correlationId: correlationId(),
        dataCutoff: instant,
        idempotencyKey: createIdempotencyKey("schedule:alerts", {
          intervalMs: intervals.alertMs
        }),
        name: "EVALUATE_ALERTS",
        version: 1
      },
      schedulerId: "alerts:five-minute"
    },
    {
      everyMs: intervals.rollupMs,
      job: {
        correlationId: correlationId(),
        cutoff: instant,
        idempotencyKey: createIdempotencyKey("schedule:rollup", {
          intervalMs: intervals.rollupMs
        }),
        name: "ROLLUP_HISTORY",
        version: 1
      },
      schedulerId: "rollup:daily"
    }
  ];
}

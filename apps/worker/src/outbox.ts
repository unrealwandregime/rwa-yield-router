import { and, asc, eq, isNull, lte } from "drizzle-orm";

import { jobOutbox, type Database } from "@rwa-yield-router/database";
import type { Logger } from "@rwa-yield-router/observability";

import { workerJobSchema } from "./jobs.js";
import type { WorkerRuntime } from "./runtime.js";

export interface OutboxPump {
  readonly stop: () => void;
  readonly flush: () => Promise<void>;
}

export function startOutboxPump(
  database: Database,
  runtime: WorkerRuntime,
  logger: Logger,
  intervalMs = 5_000
): OutboxPump {
  let running = false;
  let stopped = false;

  const flush = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const currentTime = new Date();
      const rows = await database
        .select({
          attemptCount: jobOutbox.attemptCount,
          id: jobOutbox.id,
          payload: jobOutbox.payload
        })
        .from(jobOutbox)
        .where(and(isNull(jobOutbox.publishedAt), lte(jobOutbox.availableAt, currentTime)))
        .orderBy(asc(jobOutbox.availableAt))
        .limit(50);
      for (const row of rows) {
        const parsed = workerJobSchema.safeParse(row.payload);
        if (!parsed.success) {
          await database
            .update(jobOutbox)
            .set({
              attemptCount: row.attemptCount + 1,
              lastErrorCategory: "INVALID_OUTBOX_PAYLOAD",
              publishedAt: currentTime
            })
            .where(and(eq(jobOutbox.id, row.id), isNull(jobOutbox.publishedAt)));
          logger.error("outbox.payload_rejected", { outboxId: row.id });
          continue;
        }
        try {
          await runtime.enqueue(parsed.data);
          await database
            .update(jobOutbox)
            .set({
              attemptCount: row.attemptCount + 1,
              lastErrorCategory: null,
              publishedAt: currentTime
            })
            .where(and(eq(jobOutbox.id, row.id), isNull(jobOutbox.publishedAt)));
        } catch {
          const attemptCount = row.attemptCount + 1;
          await database
            .update(jobOutbox)
            .set({
              attemptCount,
              availableAt: new Date(
                currentTime.getTime() + Math.min(300_000, 1_000 * 2 ** attemptCount)
              ),
              lastErrorCategory: "QUEUE_PUBLISH_FAILURE"
            })
            .where(and(eq(jobOutbox.id, row.id), isNull(jobOutbox.publishedAt)));
        }
      }
    } catch {
      // A transient dependency failure must not become an unhandled rejection
      // that terminates the worker. The bounded interval retries this flush;
      // rows remain unpublished and auditable until a later success.
      logger.error("outbox.flush_failed", { errorCategory: "DEPENDENCY_UNAVAILABLE" });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void flush(), intervalMs);
  timer.unref();
  void flush();
  return {
    flush,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

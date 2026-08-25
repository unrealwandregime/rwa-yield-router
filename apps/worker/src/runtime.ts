import {
  Queue,
  QueueEvents,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions
} from "bullmq";

import type { ErrorReporter, Logger, Metrics } from "@rwa-yield-router/observability";

import {
  type JobRunStore,
  type WorkerJob,
  WorkerJobError,
  type WorkerJobHandlers,
  type WorkerJobResult,
  workerJobSchema
} from "./jobs.js";
import type { WorkerSchedule } from "./schedules.js";

const QUEUE_NAME = "rwa-yield-router";
const DEAD_LETTER_QUEUE_NAME = "rwa-yield-router-dead-letter";
const JOB_VERSION = "worker-jobs-v1";

export interface WorkerRuntimeOptions {
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly drainDelaySeconds: number;
  readonly handlers: WorkerJobHandlers;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly errorReporter?: ErrorReporter | undefined;
  readonly jobRunStore: JobRunStore;
  readonly schedules?: ReadonlyArray<WorkerSchedule>;
  readonly now?: () => number;
}

export interface WorkerRuntime {
  readonly queue: Queue<WorkerJob, WorkerJobResult>;
  enqueue(job: WorkerJob): Promise<string>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export function buildJobOptions(job: WorkerJob): JobsOptions {
  return {
    attempts: job.name === "DELIVER_NOTIFICATION" ? 5 : 4,
    backoff: {
      delay: 5_000,
      type: "exponential"
    },
    jobId: job.idempotencyKey,
    removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 }
  };
}

function connectionOptionsFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss");
  }
  const database = url.pathname === "" || url.pathname === "/" ? 0 : Number(url.pathname.slice(1));
  if (!Number.isInteger(database) || database < 0) {
    throw new Error("REDIS_URL database index is invalid");
  }
  return {
    commandTimeout: 3_000,
    connectTimeout: 5_000,
    db: database,
    enableReadyCheck: true,
    host: url.hostname,
    maxRetriesPerRequest: null,
    ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
    port: url.port === "" ? 6379 : Number(url.port),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    ...(url.username === "" ? {} : { username: decodeURIComponent(url.username) })
  };
}

async function dispatchJob(
  handlers: WorkerJobHandlers,
  job: WorkerJob,
  context: { attempt: number; jobId: string }
): Promise<WorkerJobResult> {
  switch (job.name) {
    case "INGEST_SOURCE":
      return handlers.INGEST_SOURCE(job, context);
    case "ROLLUP_HISTORY":
      return handlers.ROLLUP_HISTORY(job, context);
    case "RECALCULATE_RISK":
      return handlers.RECALCULATE_RISK(job, context);
    case "EVALUATE_ALERTS":
      return handlers.EVALUATE_ALERTS(job, context);
    case "DELIVER_NOTIFICATION":
      return handlers.DELIVER_NOTIFICATION(job, context);
  }
}

export async function createWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntime> {
  const connection = connectionOptionsFromUrl(options.redisUrl);
  const queue = new Queue<WorkerJob, WorkerJobResult>(QUEUE_NAME, {
    connection
  });
  const deadLetterQueue = new Queue(DEAD_LETTER_QUEUE_NAME, { connection });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  const now = options.now ?? Date.now;
  const worker = new Worker<WorkerJob, WorkerJobResult>(
    QUEUE_NAME,
    async (bullJob: Job<WorkerJob, WorkerJobResult>) => {
      const parsed = workerJobSchema.parse(bullJob.data);
      const jobId = bullJob.id ?? parsed.idempotencyKey;
      const startedAt = now();
      const attempt = bullJob.attemptsMade + 1;
      const maxAttempts = typeof bullJob.opts.attempts === "number" ? bullJob.opts.attempts : 1;
      const logger = options.logger.child({
        correlationId: parsed.correlationId,
        jobId,
        jobName: parsed.name
      });
      const runId = await options.jobRunStore.start({
        attempt,
        correlationId: parsed.correlationId,
        jobId,
        jobName: parsed.name,
        jobVersion: JOB_VERSION,
        maxAttempts,
        queuedAt: new Date(bullJob.timestamp),
        sourceReference: parsed.name === "INGEST_SOURCE" ? parsed.sourceId : null
      });
      try {
        const result = await dispatchJob(options.handlers, parsed, {
          attempt,
          jobId
        });
        const durationMs = Math.max(0, now() - startedAt);
        await options.jobRunStore.succeed(runId, result, durationMs, attempt);
        options.metrics.counter("worker_jobs_total").add(1, {
          job: parsed.name,
          outcome: result.outcome
        });
        options.metrics.histogram("worker_job_duration_ms").record(durationMs, {
          job: parsed.name
        });
        logger.info("job.completed", { durationMs, ...result });
        return result;
      } catch (error) {
        const jobError =
          error instanceof WorkerJobError
            ? error
            : new WorkerJobError("UNEXPECTED_JOB_FAILURE", true);
        if (!jobError.retryable) {
          await bullJob.discard();
        }
        const durationMs = Math.max(0, now() - startedAt);
        await options.jobRunStore.fail(runId, {
          attempt,
          code: jobError.code,
          deadLettered: !jobError.retryable || attempt >= maxAttempts,
          durationMs,
          retryable: jobError.retryable
        });
        options.metrics.counter("worker_jobs_total").add(1, {
          job: parsed.name,
          outcome: "FAILED"
        });
        void options.errorReporter?.capture(jobError, {
          attempt,
          code: jobError.code,
          jobName: parsed.name,
          retryable: jobError.retryable
        });
        logger.error("job.failed", {
          code: jobError.code,
          durationMs,
          retryable: jobError.retryable
        });
        throw jobError;
      }
    },
    {
      concurrency: options.concurrency,
      connection,
      drainDelay: options.drainDelaySeconds,
      lockDuration: 60_000,
      maxStalledCount: 1,
      stalledInterval: 30_000
    }
  );

  worker.on("failed", (job, error) => {
    if (job === undefined) {
      return;
    }
    const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    const nonRetryable = error instanceof WorkerJobError && !error.retryable;
    if (!nonRetryable && job.attemptsMade < attempts) {
      return;
    }
    const parsed = workerJobSchema.safeParse(job.data);
    if (!parsed.success) {
      return;
    }
    void deadLetterQueue
      .add(
        "FAILED_JOB",
        {
          code: error instanceof WorkerJobError ? error.code : "UNEXPECTED_JOB_FAILURE",
          failedAt: new Date().toISOString(),
          job: parsed.data
        },
        {
          jobId: "dlq:" + (job.id ?? parsed.data.idempotencyKey),
          removeOnComplete: false,
          removeOnFail: false
        }
      )
      .then(() => {
        options.metrics.counter("worker_dead_letter_total").add(1, {
          job: parsed.data.name,
          outcome: "SUCCEEDED"
        });
      })
      .catch(() => {
        options.metrics.counter("worker_dead_letter_total").add(1, {
          job: parsed.data.name,
          outcome: "FAILED"
        });
        options.logger.error("job.dead_letter_failed", {
          code: "DEAD_LETTER_WRITE_FAILURE",
          jobName: parsed.data.name
        });
        void options.errorReporter?.capture(new Error("Worker dead-letter write failed"), {
          code: "DEAD_LETTER_WRITE_FAILURE",
          jobName: parsed.data.name
        });
      });
  });

  worker.on("error", () => {
    options.metrics.counter("worker_dependency_errors_total").add(1, { operation: "worker" });
    options.logger.error("worker.dependency_error", {
      code: "QUEUE_WORKER_FAILURE",
      operation: "worker"
    });
    void options.errorReporter?.capture(new Error("Worker queue dependency failed"), {
      code: "QUEUE_WORKER_FAILURE",
      operation: "worker"
    });
  });

  queueEvents.on("error", () => {
    options.metrics.counter("worker_dependency_errors_total").add(1, {
      operation: "queue_events"
    });
    options.logger.error("worker.dependency_error", {
      code: "QUEUE_EVENTS_FAILURE",
      operation: "queue_events"
    });
    void options.errorReporter?.capture(new Error("Worker queue events dependency failed"), {
      code: "QUEUE_EVENTS_FAILURE",
      operation: "queue_events"
    });
  });

  for (const schedule of options.schedules ?? []) {
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { every: schedule.everyMs },
      {
        data: schedule.job,
        name: schedule.job.name,
        opts: buildJobOptions(schedule.job)
      }
    );
  }

  await queueEvents.waitUntilReady();
  await worker.waitUntilReady();

  return {
    queue,
    async enqueue(job) {
      const parsed = workerJobSchema.parse(job);
      try {
        const queued = await queue.add(parsed.name, parsed, buildJobOptions(parsed));
        options.metrics.counter("worker_enqueue_total").add(1, {
          job: parsed.name,
          outcome: "SUCCEEDED"
        });
        return queued.id ?? parsed.idempotencyKey;
      } catch (error) {
        options.metrics.counter("worker_enqueue_total").add(1, {
          job: parsed.name,
          outcome: "FAILED"
        });
        void options.errorReporter?.capture(new Error("Worker enqueue failed"), {
          code: "QUEUE_ENQUEUE_FAILURE",
          jobName: parsed.name
        });
        throw error;
      }
    },
    async ready() {
      try {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
        for (const state of ["waiting", "active", "delayed", "failed"] as const)
          options.metrics.gauge("worker_queue_jobs").set(counts[state] ?? 0, { state });
        const running = worker.isRunning();
        options.metrics.gauge("worker_ready").set(running ? 1 : 0);
        return running;
      } catch {
        options.metrics.gauge("worker_ready").set(0);
        return false;
      }
    },
    async close() {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      await deadLetterQueue.close();
    }
  };
}

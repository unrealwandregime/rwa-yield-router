import { and, desc, eq, or } from "drizzle-orm";

import {
  adapterHealth,
  createJobRun,
  deadLetterJobs,
  jobRuns,
  sourceRegistry,
  type Database
} from "@rwa-yield-router/database";

import type { JobRunStore, WorkerJobResult } from "./jobs.js";

const DEAD_LETTER_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const classifyAdapterHealthOutcome = (result: WorkerJobResult): "SUCCEEDED" | "DEGRADED" =>
  result.recordsRejected > 0 || result.staleRecords > 0 ? "DEGRADED" : "SUCCEEDED";

export interface DatabaseJobRunStoreOptions {
  readonly adapterVersions?: Readonly<Record<string, string>>;
  readonly now?: () => Date;
}

interface InFlightRunMetadata {
  readonly adapterVersion: string | null;
  readonly attemptedAt: Date;
  readonly jobId: string;
  readonly jobName: string;
  readonly sourceId: string | null;
}

export const createDatabaseJobRunStore = (
  database: Database,
  options: DatabaseJobRunStoreOptions = {}
): JobRunStore => {
  const now = options.now ?? (() => new Date());
  const inFlight = new Map<string, InFlightRunMetadata>();

  return {
    async fail(runId, input) {
      const completedAt = now();
      const metadata = inFlight.get(runId);
      await database.transaction(async (transaction) => {
        const [completed] = await transaction
          .update(jobRuns)
          .set({
            completedAt,
            deadLetterCount: input.deadLettered ? 1 : 0,
            errorCategory: input.code,
            freshRecordCount: 0,
            recordsAccepted: 0,
            recordsChanged: 0,
            recordsRead: 0,
            recordsRejected: 0,
            retryCount: Math.max(0, input.attempt - 1),
            staleRecordCount: 0,
            status: input.deadLettered ? "DEAD_LETTERED" : "FAILED",
            updatedAt: completedAt
          })
          .where(and(eq(jobRuns.id, runId), eq(jobRuns.status, "RUNNING")))
          .returning();
        if (completed === undefined) throw new Error("Running job could not transition to failed");

        if (
          metadata?.sourceId !== null &&
          metadata?.sourceId !== undefined &&
          metadata.adapterVersion !== null
        ) {
          await transaction.insert(adapterHealth).values({
            adapterVersion: metadata.adapterVersion,
            attemptedAt: metadata.attemptedAt,
            correlationId: completed.correlationId,
            deadLetterCount: input.deadLettered ? 1 : 0,
            durationMs: input.durationMs,
            errorCategory: input.code,
            freshRecordCount: 0,
            outcome: "FAILED",
            recordsAccepted: 0,
            recordsChanged: 0,
            recordsRead: 0,
            recordsRejected: 0,
            retryCount: Math.max(0, input.attempt - 1),
            sourceId: metadata.sourceId,
            staleRecordCount: 0,
            succeededAt: null
          });
        }

        if (input.deadLettered) {
          await transaction
            .insert(deadLetterJobs)
            .values({
              errorCategory: input.code,
              expiresAt: new Date(completedAt.getTime() + DEAD_LETTER_RETENTION_MS),
              jobRunId: completed.id,
              payloadVersion: completed.payloadVersion,
              redactedPayload: {
                idempotencyKey: metadata?.jobId ?? completed.idempotencyKey,
                jobName: metadata?.jobName ?? completed.jobName
              }
            })
            .onConflictDoNothing({ target: deadLetterJobs.jobRunId });
        }
      });
      inFlight.delete(runId);
    },

    async start(input) {
      const source =
        input.sourceReference === null
          ? undefined
          : (
              await database
                .select({ id: sourceRegistry.id })
                .from(sourceRegistry)
                .where(
                  and(
                    or(
                      eq(sourceRegistry.code, input.sourceReference),
                      eq(sourceRegistry.code, `CATALOG-${input.sourceReference}`)
                    ),
                    eq(sourceRegistry.publicationStatus, "PUBLISHED"),
                    eq(sourceRegistry.status, "ACTIVE")
                  )
                )
                .orderBy(desc(sourceRegistry.version))
                .limit(1)
            )[0];
      const startedAt = new Date(Math.max(now().getTime(), input.queuedAt.getTime()));
      const run = await createJobRun(database, {
        attempt: input.attempt,
        correlationId: input.correlationId,
        idempotencyKey: input.jobId,
        jobName: input.jobName,
        jobVersion: input.jobVersion,
        maxAttempts: input.maxAttempts,
        payloadVersion: "1",
        producerIdentity: "rwa-yield-router-worker",
        queuedAt: input.queuedAt,
        sourceId: source?.id ?? null,
        startedAt,
        status: "RUNNING"
      });
      inFlight.set(run.id, {
        adapterVersion:
          input.sourceReference === null
            ? null
            : (options.adapterVersions?.[input.sourceReference] ?? null),
        attemptedAt: startedAt,
        jobId: input.jobId,
        jobName: input.jobName,
        sourceId: source?.id ?? null
      });
      return run.id;
    },

    async succeed(runId, result, durationMs, attempt) {
      const completedAt = now();
      const metadata = inFlight.get(runId);
      await database.transaction(async (transaction) => {
        const [completed] = await transaction
          .update(jobRuns)
          .set({
            completedAt,
            deadLetterCount: 0,
            errorCategory: null,
            freshRecordCount: Math.max(0, result.recordsAccepted - result.staleRecords),
            recordsAccepted: result.recordsAccepted,
            recordsChanged: result.recordsChanged,
            recordsRead: result.recordsRead,
            recordsRejected: result.recordsRejected,
            retryCount: Math.max(0, attempt - 1),
            staleRecordCount: result.staleRecords,
            status: "SUCCEEDED",
            updatedAt: completedAt
          })
          .where(and(eq(jobRuns.id, runId), eq(jobRuns.status, "RUNNING")))
          .returning();
        if (completed === undefined)
          throw new Error("Running job could not transition to succeeded");

        if (
          metadata?.sourceId !== null &&
          metadata?.sourceId !== undefined &&
          metadata.adapterVersion !== null
        ) {
          const outcome = classifyAdapterHealthOutcome(result);
          await transaction.insert(adapterHealth).values({
            adapterVersion: metadata.adapterVersion,
            attemptedAt: metadata.attemptedAt,
            correlationId: completed.correlationId,
            deadLetterCount: 0,
            durationMs,
            errorCategory: outcome === "DEGRADED" ? "PARTIAL_OR_STALE_RESULT" : null,
            freshRecordCount: Math.max(0, result.recordsAccepted - result.staleRecords),
            outcome,
            recordsAccepted: result.recordsAccepted,
            recordsChanged: result.recordsChanged,
            recordsRead: result.recordsRead,
            recordsRejected: result.recordsRejected,
            retryCount: Math.max(0, attempt - 1),
            sourceId: metadata.sourceId,
            staleRecordCount: result.staleRecords,
            succeededAt: outcome === "SUCCEEDED" || result.recordsAccepted > 0 ? completedAt : null
          });
        }
      });
      inFlight.delete(runId);
    }
  };
};

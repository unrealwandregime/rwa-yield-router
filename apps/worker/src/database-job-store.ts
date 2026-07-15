import { completeRunningJob, createJobRun, type Database } from "@rwa-yield-router/database";

import type { JobRunStore } from "./jobs.js";

export const createDatabaseJobRunStore = (
  database: Database,
  now: () => Date = () => new Date()
): JobRunStore => ({
  async fail(runId, input) {
    const completed = await completeRunningJob(database, {
      completedAt: now(),
      deadLetterCount: input.retryable ? 0 : 1,
      errorCategory: input.code,
      freshRecordCount: 0,
      id: runId,
      recordsAccepted: 0,
      recordsChanged: 0,
      recordsRead: 0,
      recordsRejected: 0,
      retryCount: Math.max(0, input.attempt - 1),
      staleRecordCount: 0,
      status: "FAILED"
    });
    if (completed === null) throw new Error("Running job could not transition to failed");
  },
  async start(input) {
    const startedAt = now();
    const run = await createJobRun(database, {
      attempt: input.attempt,
      correlationId: input.correlationId,
      idempotencyKey: input.jobId,
      jobName: input.jobName,
      jobVersion: input.adapterVersion ?? "worker-jobs-v1",
      maxAttempts: input.maxAttempts,
      payloadVersion: "1",
      producerIdentity: "rwa-yield-router-worker",
      queuedAt: input.queuedAt,
      startedAt,
      status: "RUNNING"
    });
    return run.id;
  },
  async succeed(runId, result, _durationMs, attempt) {
    const completed = await completeRunningJob(database, {
      completedAt: now(),
      deadLetterCount: 0,
      freshRecordCount: Math.max(0, result.recordsAccepted - result.staleRecords),
      id: runId,
      recordsAccepted: result.recordsAccepted,
      recordsChanged: result.recordsChanged,
      recordsRead: result.recordsRead,
      recordsRejected: result.recordsRejected,
      retryCount: Math.max(0, attempt - 1),
      staleRecordCount: result.staleRecords,
      status: "SUCCEEDED"
    });
    if (completed === null) throw new Error("Running job could not transition to succeeded");
  }
});

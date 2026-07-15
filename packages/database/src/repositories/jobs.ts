import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { jobRuns, type JobRun, type NewJobRun } from "../schema/index.js";

export const createJobRun = async (database: Database, run: NewJobRun): Promise<JobRun> => {
  const [created] = await database.insert(jobRuns).values(run).returning();
  if (created === undefined) {
    throw new Error("Job run insert returned no row");
  }
  return created;
};

export interface CompleteJobRunInput {
  readonly id: string;
  readonly status: "SUCCEEDED" | "FAILED" | "DEAD_LETTERED" | "CANCELLED";
  readonly completedAt: Date;
  readonly recordsRead: number;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly retryCount: number;
  readonly deadLetterCount: number;
  readonly freshRecordCount: number;
  readonly staleRecordCount: number;
  readonly errorCategory?: string | null;
}

export const completeRunningJob = async (
  database: Database,
  input: CompleteJobRunInput
): Promise<JobRun | null> => {
  const [completed] = await database
    .update(jobRuns)
    .set({
      completedAt: input.completedAt,
      deadLetterCount: input.deadLetterCount,
      errorCategory: input.errorCategory,
      freshRecordCount: input.freshRecordCount,
      recordsAccepted: input.recordsAccepted,
      recordsChanged: input.recordsChanged,
      recordsRead: input.recordsRead,
      recordsRejected: input.recordsRejected,
      retryCount: input.retryCount,
      staleRecordCount: input.staleRecordCount,
      status: input.status,
      updatedAt: input.completedAt
    })
    .where(and(eq(jobRuns.id, input.id), eq(jobRuns.status, "RUNNING")))
    .returning();

  return completed ?? null;
};

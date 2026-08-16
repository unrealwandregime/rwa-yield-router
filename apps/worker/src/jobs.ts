import { z } from "zod";

const baseJobSchema = z.object({
  version: z.literal(1),
  correlationId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(256)
});

export const workerJobSchema = z.discriminatedUnion("name", [
  baseJobSchema
    .extend({
      name: z.literal("INGEST_SOURCE"),
      sourceId: z.string().trim().min(1).max(128),
      externalEntityId: z.string().trim().min(1).max(256).nullable()
    })
    .strict(),
  baseJobSchema
    .extend({
      name: z.literal("ROLLUP_HISTORY"),
      cutoff: z.iso.datetime({ offset: true }).nullable()
    })
    .strict(),
  baseJobSchema
    .extend({
      name: z.literal("RECALCULATE_RISK"),
      routeId: z.uuid().nullable(),
      dataCutoff: z.iso.datetime({ offset: true })
    })
    .strict(),
  baseJobSchema
    .extend({
      name: z.literal("EVALUATE_ALERTS"),
      dataCutoff: z.iso.datetime({ offset: true })
    })
    .strict(),
  baseJobSchema
    .extend({
      name: z.literal("DELIVER_NOTIFICATION"),
      deliveryId: z.uuid()
    })
    .strict()
]);

export type WorkerJob = z.infer<typeof workerJobSchema>;
export type WorkerJobName = WorkerJob["name"];

export interface WorkerJobResult {
  readonly outcome: "SUCCEEDED" | "DUPLICATE";
  readonly recordsRead: number;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsChanged: number;
  readonly staleRecords: number;
}

export interface JobHandlerContext {
  readonly attempt: number;
  readonly jobId: string;
}

export type JobHandler<TJob extends WorkerJob = WorkerJob> = (
  job: TJob,
  context: JobHandlerContext
) => Promise<WorkerJobResult>;

export type WorkerJobHandlers = Readonly<{
  [TName in WorkerJobName]: JobHandler<Extract<WorkerJob, { name: TName }>>;
}>;

export class WorkerJobError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "WorkerJobError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface JobRunStore {
  start(
    input: Readonly<{
      jobId: string;
      jobName: WorkerJobName;
      correlationId: string;
      attempt: number;
      jobVersion: string;
      maxAttempts: number;
      queuedAt: Date;
      sourceReference: string | null;
    }>
  ): Promise<string>;
  succeed(
    runId: string,
    result: WorkerJobResult,
    durationMs: number,
    attempt: number
  ): Promise<void>;
  fail(
    runId: string,
    input: Readonly<{
      code: string;
      deadLettered: boolean;
      durationMs: number;
      attempt: number;
      retryable: boolean;
    }>
  ): Promise<void>;
}

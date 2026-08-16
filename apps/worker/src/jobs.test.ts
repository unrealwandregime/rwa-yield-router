import { describe, expect, it } from "vitest";

import { workerJobSchema } from "./jobs.js";
import { buildJobOptions } from "./runtime.js";
import { createDefaultSchedules } from "./schedules.js";

describe("worker schedules", () => {
  it("are deterministic, bounded, and versioned", () => {
    const schedules = createDefaultSchedules({
      correlationId: () => "test-correlation",
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });

    expect(schedules.map((schedule) => schedule.everyMs)).toEqual([
      900_000, 3_600_000, 300_000, 86_400_000
    ]);
    expect(schedules.every((schedule) => schedule.job.version === 1)).toBe(true);
    expect(
      schedules.find((schedule) => schedule.schedulerId === "rollup:daily")?.job
    ).toMatchObject({
      cutoff: null,
      name: "ROLLUP_HISTORY"
    });
  });

  it("uses bounded exponential retries and stable job ids", () => {
    const job = createDefaultSchedules({
      correlationId: () => "test-correlation",
      now: () => new Date("2026-07-13T00:00:00.000Z")
    })[0]?.job;
    if (job === undefined) {
      throw new Error("Expected ingestion schedule");
    }
    expect(buildJobOptions(job)).toMatchObject({
      attempts: 4,
      backoff: { delay: 5_000, type: "exponential" },
      jobId: job.idempotencyKey
    });
  });

  it("queues notification delivery by opaque database id without a plaintext destination", () => {
    const job = workerJobSchema.parse({
      correlationId: "9f548056-aaf0-4a10-bec4-b78c4430a401",
      deliveryId: "25b2f631-fb2b-4d93-9097-14885f48646c",
      idempotencyKey: "notification:25b2f631-fb2b-4d93-9097-14885f48646c",
      name: "DELIVER_NOTIFICATION",
      version: 1
    });

    expect(job).not.toHaveProperty("message");
    expect(JSON.stringify(job)).not.toMatch(/destination|@example|chat_id/iu);
    expect(() =>
      workerJobSchema.parse({
        ...job,
        message: { destination: "person@example.com" }
      })
    ).toThrow();
  });
});

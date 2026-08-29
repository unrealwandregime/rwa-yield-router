import type { Database } from "@rwa-yield-router/database";
import { createStructuredLogger } from "@rwa-yield-router/observability";
import { describe, expect, it, vi } from "vitest";

import { workerJobSchema } from "./jobs.js";
import { startOutboxPump } from "./outbox.js";
import type { WorkerRuntime } from "./runtime.js";

describe("admin outbox job contract", () => {
  it("accepts a targeted source re-sync without carrying credentials", () => {
    const parsed = workerJobSchema.parse({
      correlationId: "e6e69843-d64b-493a-83c9-da40b02115de",
      externalEntityId: "1:0xbeef01735c132ada46aa9aa4c54623caa92a64cb",
      idempotencyKey: "admin-resync:steakhouse-usdc-ethereum:1",
      name: "INGEST_SOURCE",
      sourceId: "MORPHO-API",
      version: 1
    });

    expect(parsed.name).toBe("INGEST_SOURCE");
    expect(JSON.stringify(parsed)).not.toMatch(/token|secret|password/iu);
  });

  it("keeps running when a transient database failure rejects a flush", async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      environment: "test",
      service: "worker-test",
      write: (line) => lines.push(line)
    });
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.reject(new Error("connection pool exhausted"))
            })
          })
        })
      })
    } as unknown as Database;
    const runtime = { enqueue: vi.fn() } as unknown as WorkerRuntime;

    const pump = startOutboxPump(database, runtime, logger, 60_000);
    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes('"event":"outbox.flush_failed"'))).toBe(true);
    });
    await expect(pump.flush()).resolves.toBeUndefined();
    pump.stop();
  });
});

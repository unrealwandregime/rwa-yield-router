import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { collectOperationalStatus } from "@/lib/operational-status";

describe("operational status", () => {
  it("does not probe services that are not configured", async () => {
    const probeDatabase = vi.fn(async () => {
      throw new Error("must not run");
    });
    const probeRateLimitStore = vi.fn(async () => true);

    const status = await collectOperationalStatus({
      databaseConfigured: false,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      probeDatabase,
      probeRateLimitStore,
      redisConfigured: false
    });

    expect(status).toEqual({
      checkedAt: "2026-07-14T00:00:00.000Z",
      database: { latencyMs: null, state: "NOT_CONFIGURED" },
      latestAdapter: null,
      latestJob: null,
      rateLimitStore: { state: "NOT_CONFIGURED" },
      schema: { state: "NOT_CONFIGURED" }
    });
    expect(probeDatabase).not.toHaveBeenCalled();
    expect(probeRateLimitStore).not.toHaveBeenCalled();
  });

  it("reports live probes while constraining database-provided public values", async () => {
    const status = await collectOperationalStatus({
      databaseConfigured: true,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      probeDatabase: async () => ({
        healthy: true,
        latencyMs: 12.6,
        schemaCompatible: true,
        latestJob: {
          completedAt: new Date("2026-07-13T23:59:00.000Z"),
          deadLetterCount: 0,
          errorCategory: "postgres://private.internal/secret",
          jobName: "user-123-private-job",
          queuedAt: new Date("2026-07-13T23:58:00.000Z"),
          recordsAccepted: 4,
          recordsChanged: 2,
          recordsRejected: 1,
          retryCount: 1,
          staleRecordCount: 0,
          startedAt: new Date("2026-07-13T23:58:10.000Z"),
          status: "SUCCEEDED"
        },
        latestAdapter: {
          adapterVersion: "morpho-v1.2.3",
          attemptedAt: new Date("2026-07-13T23:57:00.000Z"),
          deadLetterCount: 0,
          durationMs: 250,
          errorCategory: null,
          outcome: "DEGRADED",
          providerCode: "MORPHO_OFFICIAL",
          recordsAccepted: 4,
          recordsChanged: 2,
          recordsRejected: 1,
          retryCount: 1,
          staleRecordCount: 3,
          succeededAt: null
        }
      }),
      probeRateLimitStore: async () => true,
      redisConfigured: true
    });

    expect(status.database).toEqual({ latencyMs: 13, state: "HEALTHY" });
    expect(status.schema.state).toBe("COMPATIBLE");
    expect(status.rateLimitStore.state).toBe("HEALTHY");
    expect(status.latestJob?.jobName).toBe("OTHER_JOB");
    expect(status.latestJob?.errorCategory).toBe("REDACTED_FAILURE");
    expect(status.latestAdapter).toMatchObject({
      adapterVersion: "morpho-v1.2.3",
      outcome: "DEGRADED",
      providerCode: "MORPHO_OFFICIAL",
      staleRecordCount: 3
    });
    expect(JSON.stringify(status)).not.toContain("private.internal");
    expect(JSON.stringify(status)).not.toContain("user-123");
  });
});

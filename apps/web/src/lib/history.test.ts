import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@rwa-yield-router/database", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@rwa-yield-router/database")),
  getDatabase: databaseMocks.getDatabase
}));

import { getYieldHistory } from "@/lib/history";

const originalDatabaseUrl = process.env.DATABASE_URL;

const createQuery = (rows: readonly unknown[]) => {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    limit: vi.fn(async () => rows),
    orderBy: vi.fn(),
    where: vi.fn()
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
};

const observation = {
  observationAdapterVersion: "official-api@2.0.0",
  observationConfidence: "DIRECT_API",
  observationFetchedAt: new Date("2026-07-17T22:00:02.000Z"),
  observationId: "11111111-1111-4111-8111-111111111111",
  observationMetric: "NET_APY",
  observationObservedAt: new Date("2026-07-17T22:00:00.000Z"),
  observationSourceRevision: "revision-17",
  observationStatus: "AVAILABLE",
  observationUnit: "DECIMAL_RATIO",
  observationVerifiedAt: new Date("2026-07-17T22:05:00.000Z"),
  sourceCode: "OFFICIAL-YIELD",
  sourceId: "22222222-2222-4222-8222-222222222222",
  sourceName: "Official yield API",
  sourceType: "OFFICIAL_API",
  sourceUrl: "https://issuer.example/yield"
} as const;

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://unit-test";
  databaseMocks.getDatabase.mockReset();
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("yield history provenance", () => {
  it("joins a rollup through its selected snapshot to the actual observation and source", async () => {
    const routeQuery = createQuery([{ id: "route-id" }]);
    const rollupQuery = createQuery([
      {
        ...observation,
        at: new Date("2026-07-17T22:00:00.000Z"),
        pointConfidence: "DIRECT_API",
        pointStatus: "AVAILABLE",
        rollupBucketStart: new Date("2026-07-17T00:00:00.000Z"),
        rollupCalculationVersion: "history-daily@1.0.0",
        rollupDataCutoff: new Date("2026-07-18T00:00:00.000Z"),
        rollupId: "33333333-3333-4333-8333-333333333333",
        rollupUpdatedAt: new Date("2026-07-18T00:05:00.000Z"),
        snapshotAsOf: new Date("2026-07-17T22:00:00.000Z"),
        snapshotCalculationVersion: "yield@3.0.0",
        snapshotConfidence: "DIRECT_API",
        snapshotId: "44444444-4444-4444-8444-444444444444",
        snapshotSelectionPolicyVersion: "source-selection@2.0.0",
        snapshotStatus: "AVAILABLE",
        value: "0.041000000000000000"
      }
    ]);
    const select = vi.fn().mockReturnValueOnce(routeQuery).mockReturnValueOnce(rollupQuery);
    databaseMocks.getDatabase.mockReturnValue({ select });

    const result = await getYieldHistory("official-route");

    expect(rollupQuery.innerJoin).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      observation: {
        id: observation.observationId,
        sourceRevision: "revision-17"
      },
      rollup: { id: "33333333-3333-4333-8333-333333333333" },
      snapshot: { id: "44444444-4444-4444-8444-444444444444" },
      source: { code: "OFFICIAL-YIELD", url: "https://issuer.example/yield" }
    });
  });

  it("preserves raw snapshot provenance when no daily rollup exists", async () => {
    const routeQuery = createQuery([{ id: "route-id" }]);
    const rollupQuery = createQuery([]);
    const snapshotQuery = createQuery([
      {
        ...observation,
        at: new Date("2026-07-17T22:00:00.000Z"),
        pointConfidence: "DIRECT_API",
        pointStatus: "AVAILABLE",
        snapshotCalculationVersion: "yield@3.0.0",
        snapshotId: "44444444-4444-4444-8444-444444444444",
        snapshotSelectionPolicyVersion: "source-selection@2.0.0",
        value: "0.041000000000000000"
      }
    ]);
    const select = vi
      .fn()
      .mockReturnValueOnce(routeQuery)
      .mockReturnValueOnce(rollupQuery)
      .mockReturnValueOnce(snapshotQuery);
    databaseMocks.getDatabase.mockReturnValue({ select });

    const result = await getYieldHistory("official-route");

    expect(snapshotQuery.innerJoin).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({
      observation: { id: observation.observationId },
      rollup: null,
      snapshot: { id: "44444444-4444-4444-8444-444444444444" },
      source: { id: observation.sourceId }
    });
  });
});

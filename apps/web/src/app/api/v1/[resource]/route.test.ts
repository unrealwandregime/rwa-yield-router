import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET as getDetail } from "./[slug]/route";
import { GET } from "./route";

const { mockHistory, mockRecords } = vi.hoisted(() => ({
  mockHistory: [
    {
      at: "2026-07-17T08:00:00.000Z",
      confidence: "DIRECT_API",
      observation: {
        adapterVersion: "official-api@2.1.0",
        confidence: "DIRECT_API",
        fetchedAt: "2026-07-17T08:00:02.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        metric: "NET_APY",
        observedAt: "2026-07-17T08:00:00.000Z",
        sourceRevision: "rev-a",
        status: "AVAILABLE",
        unit: "DECIMAL_RATIO",
        verifiedAt: "2026-07-17T08:05:00.000Z"
      },
      rollup: {
        bucketStart: "2026-07-17T00:00:00.000Z",
        calculationVersion: "history-daily@1.0.0",
        dataCutoff: "2026-07-18T00:00:00.000Z",
        id: "22222222-2222-4222-8222-222222222222",
        updatedAt: "2026-07-18T00:05:00.000Z"
      },
      snapshot: {
        asOf: "2026-07-17T08:00:00.000Z",
        calculationVersion: "yield@3.0.0",
        confidence: "DIRECT_API",
        id: "33333333-3333-4333-8333-333333333333",
        selectionPolicyVersion: "source-selection@2.0.0",
        status: "AVAILABLE"
      },
      source: {
        code: "HISTORY-A",
        id: "44444444-4444-4444-8444-444444444444",
        name: "Historical official A",
        type: "OFFICIAL_API",
        url: "https://history-a.example"
      },
      status: "AVAILABLE",
      value: "0.041"
    },
    {
      at: "2026-07-18T08:00:00.000Z",
      confidence: "ONCHAIN_DERIVED",
      observation: {
        adapterVersion: "chain-reader@4.0.0",
        confidence: "ONCHAIN_DERIVED",
        fetchedAt: "2026-07-18T08:00:10.000Z",
        id: "55555555-5555-4555-8555-555555555555",
        metric: "NET_APY",
        observedAt: "2026-07-18T08:00:00.000Z",
        sourceRevision: "block-123",
        status: "AVAILABLE",
        unit: "DECIMAL_RATIO",
        verifiedAt: null
      },
      rollup: null,
      snapshot: {
        asOf: "2026-07-18T08:00:00.000Z",
        calculationVersion: "yield@3.0.0",
        confidence: "ONCHAIN_DERIVED",
        id: "66666666-6666-4666-8666-666666666666",
        selectionPolicyVersion: "source-selection@2.0.0",
        status: "AVAILABLE"
      },
      source: {
        code: "HISTORY-B",
        id: "77777777-7777-4777-8777-777777777777",
        name: "Historical chain B",
        type: "ONCHAIN",
        url: "https://history-b.example"
      },
      status: "AVAILABLE",
      value: "0.043"
    }
  ],
  mockRecords: [
    {
      observedAt: "2026-07-18T08:00:00.000Z",
      slug: "route-a",
      source: { name: "Official A", type: "OFFICIAL_API", url: "https://a.example" },
      verifiedAt: "2026-07-17T00:00:00.000Z"
    },
    {
      observedAt: "2026-07-18T09:00:00.000Z",
      slug: "route-b",
      source: { name: "Official B", type: "OFFICIAL_API", url: "https://b.example" },
      verifiedAt: "2026-07-18T00:00:00.000Z"
    }
  ]
}));

vi.mock("@/lib/live-morpho", () => ({
  getLiveCatalog: vi.fn(async () => mockRecords)
}));

vi.mock("@/lib/history", () => ({
  getYieldHistory: vi.fn(async () => mockHistory)
}));

vi.mock("@/lib/public-read-model", () => ({
  getEffectiveMethodology: vi.fn(async () => null)
}));

describe("extended public API resources", () => {
  it("returns requested comparison routes in stable order", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/comparison?routes=route-b,route-a"),
      { params: Promise.resolve({ resource: "comparison" }) }
    );
    const payload = (await response.json()) as { data: Array<{ slug: string }> };

    expect(response.status).toBe(200);
    expect(payload.data.map((record) => record.slug)).toEqual(["route-b", "route-a"]);
  });

  it("requires two unique comparison routes", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/comparison?routes=route-a"),
      { params: Promise.resolve({ resource: "comparison" }) }
    );

    expect(response.status).toBe(400);
  });

  it("returns paginated sourced historical yield", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/historical-yield?route=route-a&limit=1"),
      { params: Promise.resolve({ resource: "historical-yield" }) }
    );
    const payload = (await response.json()) as {
      data: Array<{
        confidence: string;
        netApy: string;
        observation: { id: string };
        routeSlug: string;
        source: { code: string };
      }>;
      meta: { nextCursor: string | null; sourceTimestamp: string | null; total: number };
    };

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      confidence: "DIRECT_API",
      netApy: "0.041",
      observation: { id: mockHistory[0]?.observation.id },
      routeSlug: "route-a",
      source: { code: "HISTORY-A" }
    });
    expect(payload.data[0]?.source).not.toEqual(mockRecords[0]?.source);
    expect(payload.meta.total).toBe(2);
    expect(payload.meta.nextCursor).not.toBeNull();
    expect(payload.meta.sourceTimestamp).toBe("2026-07-18T08:00:10.000Z");
  });

  it("returns each detail history point with its own source observation chain", async () => {
    const response = await getDetail(
      new NextRequest("http://localhost/api/v1/historical-yield/route-a"),
      { params: Promise.resolve({ resource: "historical-yield", slug: "route-a" }) }
    );
    const payload = (await response.json()) as {
      data: Array<{ observation: { id: string }; source: { code: string } }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data.map((point) => point.source.code)).toEqual(["HISTORY-A", "HISTORY-B"]);
    expect(payload.data.map((point) => point.observation.id)).toEqual([
      mockHistory[0]?.observation.id,
      mockHistory[1]?.observation.id
    ]);
  });
});

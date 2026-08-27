import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
import { AdapterError } from "./errors.js";
import { createIdempotencyKey } from "./idempotency.js";
import { MorphoGraphqlAdapter } from "./morpho.js";
import { OndoUsdyOnchainAdapter } from "./ondo-usdy.js";
import { safeFetchJson } from "./safe-fetch.js";
import { selectObservation } from "./selection.js";
import { normalizedObservationSchema } from "./types.js";

const publicResolver = async (): Promise<ReadonlyArray<{ address: string; family: 4 }>> => [
  { address: "93.184.216.34", family: 4 }
];
const valueSchema = z.object({ value: z.string() }).strict();

function policy(fetchImplementation: typeof fetch) {
  return {
    allowedContentTypes: new Set(["application/json"]),
    allowedHosts: new Set(["api.example.com"]),
    fetchImplementation,
    maxRedirects: 0,
    maxResponseBytes: 64,
    resolver: publicResolver,
    timeoutMs: 20
  };
}

describe("safeFetchJson", () => {
  it("rejects unapproved and IP-literal destinations before fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(
      safeFetchJson({
        policy: policy(fetchImplementation),
        schema: valueSchema,
        url: "https://127.0.0.1/metadata"
      })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects redirects, wrong content types, and oversized bodies", async () => {
    const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { location: "https://api.example.com/other" },
        status: 302
      })
    );
    await expect(
      safeFetchJson({
        policy: policy(redirectFetch),
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });

    const htmlFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
        status: 200
      })
    );
    await expect(
      safeFetchJson({
        policy: policy(htmlFetch),
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });

    const largeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ value: "x".repeat(100) }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    await expect(
      safeFetchJson({
        policy: policy(largeFetch),
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("enforces timeouts and provider rate limits", async () => {
    const hangingFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true
        });
      });
    await expect(
      safeFetchJson({
        policy: policy(hangingFetch),
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(
      safeFetchJson({
        policy: {
          ...policy(fetchImplementation),
          rateLimiter: {
            acquire: () => ({ allowed: false, retryAfterMs: 1_000 })
          }
        },
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("validates the provider body schema", async () => {
    const malformedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ wrong: true }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    await expect(
      safeFetchJson({
        policy: policy(malformedFetch),
        schema: valueSchema,
        url: "https://api.example.com/data"
      })
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});

describe("MorphoGraphqlAdapter", () => {
  it("normalizes official vault identity without copying live metrics", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            vaults: {
              items: [
                {
                  address: "0x1111111111111111111111111111111111111111",
                  asset: {
                    address: "0x2222222222222222222222222222222222222222",
                    decimals: 6,
                    symbol: "USDC"
                  },
                  chain: { id: 8453, network: "base" },
                  listed: true,
                  name: "TEST-ONLY Morpho Vault",
                  symbol: "mvUSDC"
                }
              ]
            }
          }
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );
    const adapter = new MorphoGraphqlAdapter({
      fetchImplementation,
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      resolver: publicResolver
    });

    const result = await adapter.discoverProducts();
    expect(result.kind).toBe("OBSERVATION");
    if (result.kind === "OBSERVATION") {
      expect(result.value[0]).toMatchObject({
        category: "STABLECOIN_VAULT",
        chainName: "Base",
        confidence: "DIRECT_API",
        underlyingAsset: "USDC"
      });
      expect("apy" in (result.value[0] ?? {})).toBe(false);
    }
  });

  it("reports malformed provider responses through health without throwing", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    const adapter = new MorphoGraphqlAdapter({
      fetchImplementation,
      monotonicNow: () => 1,
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      resolver: publicResolver
    });

    await expect(adapter.healthCheck()).resolves.toMatchObject({
      code: "MALFORMED_RESPONSE",
      status: "UNAVAILABLE"
    });
  });
});

describe("OndoUsdyOnchainAdapter", () => {
  const uint256 = (value: bigint): string => `0x${value.toString(16).padStart(64, "0")}`;
  const route = {
    chain: "Ethereum",
    routeSlug: "ondo-usdy-ethereum",
    rpcUrl: "https://rpc.example.com",
    tokenAddress: "0x96F6eF951840721AdBF46Ac996b59E0235CB985C",
    tokenKind: "EVM"
  } as const;

  it("derives annualized trailing yield from official current and historical oracle prices", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        params: readonly [{ data: string }];
      };
      const historical = request.params[0].data.startsWith("0xa712c9c7");
      return new Response(
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          result: uint256(historical ? 1_000_000_000_000_000_000n : 1_003_000_000_000_000_000n)
        }),
        { headers: { "content-type": "application/json" } }
      );
    });
    const adapter = new OndoUsdyOnchainAdapter({
      fetchImplementation,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      oracleRpcUrl: "https://rpc.example.com",
      resolver: publicResolver,
      routes: [route]
    });

    const result = await adapter.fetchYield(route.routeSlug);
    expect(result.kind).toBe("OBSERVATION");
    if (result.kind === "OBSERVATION") {
      expect(result.value).toMatchObject({
        confidence: "ONCHAIN_DERIVED",
        metric: "YIELD",
        status: "CURRENT",
        unit: "DECIMAL_RATIO"
      });
      expect(Number(result.value.normalizedValue)).toBeCloseTo(0.0371, 3);
    }
  });

  it("computes route AUM from on-chain supply and the official oracle without inventing liquidity", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: readonly [{ data?: string }];
      };
      const result =
        request.method === "eth_blockNumber"
          ? "0x10"
          : request.params[0]?.data === "0x18160ddd"
            ? uint256(2_000_000_000_000_000_000n)
            : uint256(1_250_000_000_000_000_000n);
      return new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result }), {
        headers: { "content-type": "application/json" }
      });
    });
    const adapter = new OndoUsdyOnchainAdapter({
      fetchImplementation,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      oracleRpcUrl: "https://rpc.example.com",
      resolver: publicResolver,
      routes: [route]
    });

    const result = await adapter.fetchTVLOrAUM(route.routeSlug);
    expect(result).toMatchObject({
      kind: "OBSERVATION",
      value: {
        blockNumber: "16",
        metric: "AUM",
        normalizedValue: "2.5",
        unit: "USD"
      }
    });
    expect("fetchLiquidity" in adapter).toBe(false);
  });

  it("rejects unknown route identities before making a network request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const adapter = new OndoUsdyOnchainAdapter({
      fetchImplementation,
      oracleRpcUrl: "https://rpc.example.com",
      resolver: publicResolver,
      routes: [route]
    });

    await expect(adapter.fetchYield("not-admitted")).resolves.toMatchObject({
      code: "MALFORMED_RESPONSE",
      kind: "REJECTED",
      retryable: false
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("resilience and selection helpers", () => {
  it("opens and recovers a circuit deterministically", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      now: () => now,
      recoveryTimeoutMs: 100
    });
    await expect(breaker.execute(async () => Promise.reject(new Error("fail")))).rejects.toThrow();
    await expect(breaker.execute(async () => Promise.reject(new Error("fail")))).rejects.toThrow();
    await expect(breaker.execute(async () => "blocked")).rejects.toBeInstanceOf(CircuitOpenError);
    now = 100;
    await expect(breaker.execute(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.state()).toBe("CLOSED");
  });

  it("uses a fresh fallback without changing units or missing values to zero", () => {
    const common = {
      adapterVersion: "test-v1",
      blockNumber: null,
      externalEntityId: "route-1",
      fetchedAt: "2026-07-13T00:00:00.000Z",
      metric: "YIELD",
      rawValue: null,
      sourceRecordId: null,
      status: "CURRENT",
      unit: "DECIMAL_RATIO",
      verifiedAt: null,
      warnings: []
    } as const;
    const staleOfficial = normalizedObservationSchema.parse({
      ...common,
      confidence: "DIRECT_API",
      normalizedValue: "0.05",
      observedAt: "2026-07-10T00:00:00.000Z",
      source: {
        id: "official",
        name: "Official",
        type: "OFFICIAL_API",
        url: "https://official.example.com"
      }
    });
    const freshOnchain = normalizedObservationSchema.parse({
      ...common,
      confidence: "ONCHAIN_DERIVED",
      normalizedValue: "0.04",
      observedAt: "2026-07-13T00:00:00.000Z",
      source: {
        id: "onchain",
        name: "On-chain",
        type: "ONCHAIN",
        url: "https://rpc.example.com"
      }
    });
    const result = selectObservation([staleOfficial, freshOnchain], {
      now: new Date("2026-07-13T00:10:00.000Z"),
      staleAfterMs: 30 * 60_000
    });
    expect(result).toMatchObject({
      fallbackUsed: true,
      selected: { normalizedValue: "0.04" },
      status: "SELECTED"
    });
  });

  it("creates order-independent idempotency keys", () => {
    expect(createIdempotencyKey("job", { a: 1, b: 2 })).toBe(
      createIdempotencyKey("job", { b: 2, a: 1 })
    );
    expect(() => createIdempotencyKey("job", { value: Number.NaN })).toThrow();
    expect(new AdapterError("TIMEOUT", { retryable: true }).message).toBe("TIMEOUT");
  });
});

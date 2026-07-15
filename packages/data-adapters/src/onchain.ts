import { z } from "zod";

import { AdapterError, toAdapterFailure } from "./errors.js";
import { safeFetchJson, type HostResolver } from "./safe-fetch.js";
import type { AdapterHealth, AdapterResult, DataAdapter } from "./types.js";

const jsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z.string().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string().max(500)
      })
      .optional()
  })
  .passthrough();

export interface ReadOnlyRpcAdapterOptions {
  readonly chainName: string;
  readonly rpcUrl?: string | undefined;
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly resolver?: HostResolver | undefined;
  readonly now?: (() => Date) | undefined;
  readonly monotonicNow?: (() => number) | undefined;
}

export class ReadOnlyRpcAdapter implements DataAdapter {
  public readonly id: string;
  public readonly version = "readonly-json-rpc-v1";
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;

  public constructor(private readonly options: ReadOnlyRpcAdapterOptions) {
    this.id = "RPC-" + options.chainName.toUpperCase().replace(/[^A-Z0-9]+/gu, "-");
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  public async readChainId(): Promise<AdapterResult<string>> {
    if (this.options.rpcUrl === undefined) {
      return {
        code: "RPC_NOT_CONFIGURED",
        kind: "UNAVAILABLE",
        message: "Read-only RPC access is not configured for this chain.",
        retryable: false
      };
    }
    try {
      const response = await this.rpc("eth_chainId", []);
      if (response.error !== undefined || response.result === undefined) {
        throw new AdapterError("UPSTREAM_REJECTED", { retryable: true });
      }
      return { kind: "OBSERVATION", value: response.result };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  public async healthCheck(): Promise<AdapterHealth> {
    const checkedAt = this.now().toISOString();
    const startedAt = this.monotonicNow();
    const result = await this.readChainId();
    const latencyMs = Math.max(0, this.monotonicNow() - startedAt);
    if (result.kind === "OBSERVATION") {
      return {
        adapterVersion: this.version,
        checkedAt,
        latencyMs,
        status: "HEALTHY"
      };
    }
    return {
      adapterVersion: this.version,
      checkedAt,
      code: result.code,
      latencyMs,
      status: result.kind === "UNAVAILABLE" ? "UNAVAILABLE" : "DEGRADED"
    };
  }

  private async rpc(
    method: "eth_chainId",
    params: ReadonlyArray<never>
  ): Promise<z.infer<typeof jsonRpcResponseSchema>> {
    if (this.options.rpcUrl === undefined) {
      throw new AdapterError("RPC_NOT_CONFIGURED", { retryable: false });
    }
    const endpoint = new URL(this.options.rpcUrl);
    return safeFetchJson({
      init: {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        method: "POST"
      },
      policy: {
        allowedContentTypes: new Set(["application/json"]),
        allowedHosts: new Set([endpoint.hostname.toLowerCase()]),
        fetchImplementation: this.options.fetchImplementation,
        maxCompressionRatio: 20,
        maxRedirects: 0,
        maxResponseBytes: 128 * 1024,
        resolver: this.options.resolver,
        timeoutMs: 8_000
      },
      schema: jsonRpcResponseSchema,
      url: endpoint.toString()
    });
  }
}

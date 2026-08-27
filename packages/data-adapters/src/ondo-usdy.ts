import Decimal from "decimal.js";
import { z } from "zod";

import { AdapterError, toAdapterFailure } from "./errors.js";
import { safeFetchJson, type HostResolver } from "./safe-fetch.js";
import {
  ONDO_USDY_ORACLE_ADDRESS,
  ONDO_USDY_ORACLE_RPC_URL,
  ONDO_USDY_PRODUCTION_ROUTES,
  type OndoUsdyProductionRoute
} from "./production-routes.js";
import {
  normalizedObservationSchema,
  type AdapterHealth,
  type AdapterResult,
  type NormalizedObservation,
  type NormalizedSource
} from "./types.js";

const ONDO_USDY_ADAPTER_VERSION = "ondo-usdy-onchain-v1";
const ONDO_USDY_SOURCE: NormalizedSource = {
  id: "OND-USDY",
  name: "Ondo USDY on-chain oracle and token contracts",
  type: "ONCHAIN",
  url: "https://docs.ondo.finance/addresses"
};
const GET_PRICE_SELECTOR = "0x98d5fdca";
const GET_HISTORICAL_PRICE_SELECTOR = "0xa712c9c7";
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
const TRAILING_DAYS = 30;
const jsonRpcSchema = z
  .object({
    id: z.number(),
    jsonrpc: z.literal("2.0"),
    result: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/u)
      .optional(),
    error: z.object({ code: z.number(), message: z.string().max(1_000) }).optional()
  })
  .passthrough();
const solanaSupplySchema = z
  .object({
    id: z.number(),
    jsonrpc: z.literal("2.0"),
    result: z.object({
      context: z.object({ slot: z.number().int().nonnegative() }).passthrough(),
      value: z.object({
        amount: z.string().regex(/^\d+$/u),
        decimals: z.number().int().min(0).max(18)
      })
    })
  })
  .passthrough();

export interface OndoUsdyAdapterOptions {
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly resolver?: HostResolver | undefined;
  readonly now?: (() => Date) | undefined;
  readonly monotonicNow?: (() => number) | undefined;
  readonly oracleRpcUrl?: string | undefined;
  readonly routes?: ReadonlyArray<OndoUsdyProductionRoute> | undefined;
}

const encodeUint256 = (value: bigint): string => value.toString(16).padStart(64, "0");

function decodeUint256(value: string): Decimal {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
  }
  return new Decimal(BigInt(value).toString());
}

export class OndoUsdyOnchainAdapter {
  public readonly id = "OND-USDY";
  public readonly version = ONDO_USDY_ADAPTER_VERSION;
  private readonly fetchImplementation: typeof fetch | undefined;
  private readonly resolver: HostResolver | undefined;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly oracleRpcUrl: string;
  private readonly routes: ReadonlyArray<OndoUsdyProductionRoute>;

  public constructor(options: OndoUsdyAdapterOptions = {}) {
    this.fetchImplementation = options.fetchImplementation;
    this.resolver = options.resolver;
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.oracleRpcUrl = options.oracleRpcUrl ?? ONDO_USDY_ORACLE_RPC_URL;
    this.routes = options.routes ?? ONDO_USDY_PRODUCTION_ROUTES;
  }

  private route(externalEntityId: string): OndoUsdyProductionRoute {
    const route = this.routes.find((candidate) => candidate.routeSlug === externalEntityId);
    if (route === undefined) throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
    return route;
  }

  private async rpc(url: string, method: string, params: readonly unknown[]): Promise<string> {
    const host = new URL(url).hostname.toLowerCase();
    const response = await safeFetchJson({
      url,
      init: {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: { "content-type": "application/json" },
        method: "POST"
      },
      policy: {
        allowedContentTypes: new Set(["application/json"]),
        allowedHosts: new Set([host]),
        fetchImplementation: this.fetchImplementation,
        maxRedirects: 0,
        maxResponseBytes: 32_768,
        resolver: this.resolver,
        timeoutMs: 5_000
      },
      schema: jsonRpcSchema
    });
    if (response.result === undefined || response.error !== undefined) {
      throw new AdapterError("UPSTREAM_REJECTED", { retryable: true });
    }
    return response.result;
  }

  private async priceAt(timestamp: Date | null): Promise<Decimal> {
    const data =
      timestamp === null
        ? GET_PRICE_SELECTOR
        : GET_HISTORICAL_PRICE_SELECTOR +
          encodeUint256(BigInt(Math.floor(timestamp.getTime() / 1_000)));
    const result = await this.rpc(this.oracleRpcUrl, "eth_call", [
      { data, to: ONDO_USDY_ORACLE_ADDRESS },
      "latest"
    ]);
    const price = decodeUint256(result);
    if (price.lte(0)) throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
    return price;
  }

  public async fetchYield(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>> {
    try {
      this.route(externalEntityId);
      const fetchedAt = this.now();
      const start = new Date(fetchedAt.getTime() - TRAILING_DAYS * 86_400_000);
      const [currentPrice, pastPrice] = await Promise.all([
        this.priceAt(null),
        this.priceAt(start)
      ]);
      const annualizedRatio = currentPrice
        .div(pastPrice)
        .pow(new Decimal("365.25").div(TRAILING_DAYS))
        .minus(1);
      return {
        kind: "OBSERVATION",
        value: normalizedObservationSchema.parse({
          adapterVersion: this.version,
          blockNumber: null,
          confidence: "ONCHAIN_DERIVED",
          externalEntityId,
          fetchedAt: fetchedAt.toISOString(),
          metric: "YIELD",
          normalizedValue: annualizedRatio.toSignificantDigits(18).toString(),
          observedAt: fetchedAt.toISOString(),
          rawValue: JSON.stringify({
            currentPrice: currentPrice.toFixed(0),
            pastPrice: pastPrice.toFixed(0),
            trailingDays: TRAILING_DAYS
          }),
          source: ONDO_USDY_SOURCE,
          sourceRecordId: `${ONDO_USDY_ORACLE_ADDRESS.toLowerCase()}:${Math.floor(fetchedAt.getTime() / 1_000)}`,
          status: "CURRENT",
          unit: "DECIMAL_RATIO",
          verifiedAt: fetchedAt.toISOString(),
          warnings: ["Trailing 30-day realized return annualized from the official USDY oracle"]
        })
      };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  public async fetchTVLOrAUM(
    externalEntityId: string
  ): Promise<AdapterResult<NormalizedObservation>> {
    try {
      const route = this.route(externalEntityId);
      const fetchedAt = this.now();
      const price = await this.priceAt(null);
      let supply: Decimal;
      let blockNumber: string | null = null;
      if (route.tokenKind === "EVM") {
        const [rawSupply, rawBlock] = await Promise.all([
          this.rpc(route.rpcUrl, "eth_call", [
            { data: TOTAL_SUPPLY_SELECTOR, to: route.tokenAddress },
            "latest"
          ]),
          this.rpc(route.rpcUrl, "eth_blockNumber", [])
        ]);
        supply = decodeUint256(rawSupply).div(new Decimal(10).pow(18));
        blockNumber = BigInt(rawBlock).toString();
      } else {
        const host = new URL(route.rpcUrl).hostname.toLowerCase();
        const response = await safeFetchJson({
          url: route.rpcUrl,
          init: {
            body: JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              method: "getTokenSupply",
              params: [route.tokenAddress, { commitment: "finalized" }]
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          },
          policy: {
            allowedContentTypes: new Set(["application/json"]),
            allowedHosts: new Set([host]),
            fetchImplementation: this.fetchImplementation,
            maxRedirects: 0,
            maxResponseBytes: 32_768,
            resolver: this.resolver,
            timeoutMs: 5_000
          },
          schema: solanaSupplySchema
        });
        supply = new Decimal(response.result.value.amount).div(
          new Decimal(10).pow(response.result.value.decimals)
        );
        blockNumber = String(response.result.context.slot);
      }
      const amount = supply.mul(price).div(new Decimal(10).pow(18));
      return {
        kind: "OBSERVATION",
        value: normalizedObservationSchema.parse({
          adapterVersion: this.version,
          blockNumber,
          confidence: "ONCHAIN_DERIVED",
          externalEntityId,
          fetchedAt: fetchedAt.toISOString(),
          metric: "AUM",
          normalizedValue: amount.toSignificantDigits(18).toString(),
          observedAt: fetchedAt.toISOString(),
          rawValue: JSON.stringify({
            oraclePrice: price.toFixed(0),
            tokenSupply: supply.toString()
          }),
          source: ONDO_USDY_SOURCE,
          sourceRecordId: `${route.tokenAddress}:${blockNumber ?? "latest"}`,
          status: "CURRENT",
          unit: "USD",
          verifiedAt: fetchedAt.toISOString(),
          warnings: [
            "Route AUM is circulating token supply multiplied by the official USDY oracle price"
          ]
        })
      };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  public async healthCheck(): Promise<AdapterHealth> {
    const startedAt = this.monotonicNow();
    try {
      await this.priceAt(null);
      return {
        adapterVersion: this.version,
        checkedAt: this.now().toISOString(),
        latencyMs: Math.max(0, this.monotonicNow() - startedAt),
        status: "HEALTHY"
      };
    } catch (error) {
      const failure = toAdapterFailure(error);
      return {
        adapterVersion: this.version,
        checkedAt: this.now().toISOString(),
        code: failure.code,
        latencyMs: Math.max(0, this.monotonicNow() - startedAt),
        status: failure.retryable ? "DEGRADED" : "UNAVAILABLE"
      };
    }
  }
}

export { ONDO_USDY_ADAPTER_VERSION, ONDO_USDY_SOURCE };

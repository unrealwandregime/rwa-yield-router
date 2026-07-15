import { z } from "zod";

import { CircuitBreaker } from "./circuit-breaker.js";
import { AdapterError, toAdapterFailure } from "./errors.js";
import { safeFetchJson, type HostResolver } from "./safe-fetch.js";
import {
  normalizedObservationSchema,
  normalizedProductMetadataSchema,
  type AdapterHealth,
  type AdapterResult,
  type DataAdapter,
  type NormalizedObservation,
  type NormalizedProductMetadata,
  type NormalizedSource
} from "./types.js";

const MORPHO_ADAPTER_VERSION = "morpho-graphql-v1";
const MORPHO_SOURCE: NormalizedSource = {
  id: "MORPHO-API",
  name: "Morpho API",
  type: "OFFICIAL_API",
  url: "https://api.morpho.org/graphql"
};
const chainNameById: Readonly<Record<number, string>> = {
  1: "Ethereum",
  8453: "Base"
};
const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/u);
const decimalSchema = z.union([
  z.string().regex(/^-?\d+(?:\.\d+)?$/u),
  z
    .number()
    .finite()
    .transform((value, context) => {
      const result = String(value);
      if (!/^-?\d+(?:\.\d+)?$/u.test(result)) {
        context.addIssue({ code: "custom", message: "Exponent notation is not normalized" });
        return z.NEVER;
      }
      return result;
    })
]);
const vaultSchema = z
  .object({
    address: evmAddressSchema,
    symbol: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(200),
    listed: z.boolean().optional(),
    asset: z.object({
      address: evmAddressSchema,
      symbol: z.string().trim().min(1).max(32),
      decimals: z.number().int().min(0).max(255)
    }),
    chain: z.object({
      id: z.number().int().positive(),
      network: z.string().trim().min(1).max(80)
    })
  })
  .passthrough();
const graphqlErrorsSchema = z
  .array(z.object({ message: z.string().max(1_000) }).passthrough())
  .optional();
const vaultListResponseSchema = z
  .object({
    data: z.object({
      vaults: z.object({
        items: z.array(vaultSchema).max(1_000)
      })
    }),
    errors: graphqlErrorsSchema
  })
  .passthrough();
const vaultResponseSchema = z
  .object({
    data: z.object({
      vaultByAddress: vaultSchema.nullable()
    }),
    errors: graphqlErrorsSchema
  })
  .passthrough();
const vaultYieldResponseSchema = z
  .object({
    data: z.object({
      vaultByAddress: z
        .object({
          address: evmAddressSchema,
          state: z
            .object({
              netApy: decimalSchema.nullable()
            })
            .nullable()
        })
        .nullable()
    }),
    errors: graphqlErrorsSchema
  })
  .passthrough();
const vaultAssetsResponseSchema = z
  .object({
    data: z.object({
      vaultByAddress: z
        .object({
          address: evmAddressSchema,
          state: z
            .object({
              totalAssetsUsd: decimalSchema.nullable()
            })
            .nullable()
        })
        .nullable()
    }),
    errors: graphqlErrorsSchema
  })
  .passthrough();
const vaultLiquidityResponseSchema = z
  .object({
    data: z.object({
      vaultByAddress: z
        .object({
          address: evmAddressSchema,
          liquidity: z
            .object({
              usd: decimalSchema.nullable()
            })
            .nullable()
        })
        .nullable()
    }),
    errors: graphqlErrorsSchema
  })
  .passthrough();
const healthResponseSchema = z
  .object({
    data: z.object({ __typename: z.string().min(1) }),
    errors: graphqlErrorsSchema
  })
  .passthrough();

interface ExternalVaultId {
  readonly chainId: number;
  readonly address: string;
}

export interface MorphoAdapterOptions {
  readonly endpoint?: string | undefined;
  readonly chainIds?: ReadonlyArray<number> | undefined;
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly resolver?: HostResolver | undefined;
  readonly now?: (() => Date) | undefined;
  readonly monotonicNow?: (() => number) | undefined;
}

function parseExternalVaultId(externalId: string): ExternalVaultId {
  const match = externalId.match(/^(\d+):(0x[a-fA-F0-9]{40})$/u);
  if (match === null) {
    throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
  }
  const chainId = Number(match[1]);
  const address = match[2];
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || address === undefined) {
    throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
  }
  return { address, chainId };
}

function ensureGraphqlSuccess(errors: ReadonlyArray<unknown> | undefined): void {
  if (errors !== undefined && errors.length > 0) {
    throw new AdapterError("UPSTREAM_REJECTED", { retryable: true });
  }
}

function toMetadata(
  vault: z.infer<typeof vaultSchema>,
  fetchedAt: string
): NormalizedProductMetadata {
  return normalizedProductMetadataSchema.parse({
    adapterVersion: MORPHO_ADAPTER_VERSION,
    category: "STABLECOIN_VAULT",
    chainId: vault.chain.id,
    chainName: chainNameById[vault.chain.id] ?? vault.chain.network,
    confidence: "DIRECT_API",
    contractAddress: vault.address,
    externalId: String(vault.chain.id) + ":" + vault.address.toLowerCase(),
    fetchedAt,
    name: vault.name,
    observedAt: fetchedAt,
    protocol: "Morpho",
    source: MORPHO_SOURCE,
    symbol: vault.symbol,
    underlyingAsset: vault.asset.symbol,
    warnings: [
      "Official API identity requires read-only on-chain reconciliation before route availability."
    ],
    yieldSource: "VAULT_STRATEGY"
  });
}

function unavailable(code: string): AdapterResult<never> {
  return {
    code,
    kind: "UNAVAILABLE",
    message: "The requested Morpho value is unavailable.",
    retryable: false
  };
}

export class MorphoGraphqlAdapter implements DataAdapter {
  public readonly id = "MORPHO-API";
  public readonly version = MORPHO_ADAPTER_VERSION;
  private readonly endpoint: string;
  private readonly chainIds: ReadonlyArray<number>;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly circuitBreaker: CircuitBreaker;

  public constructor(private readonly options: MorphoAdapterOptions = {}) {
    this.endpoint = options.endpoint ?? MORPHO_SOURCE.url;
    this.chainIds = options.chainIds ?? [1, 8453];
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      now: this.monotonicNow,
      recoveryTimeoutMs: 60_000,
      successThreshold: 2
    });
  }

  public async discoverProducts(): Promise<
    AdapterResult<ReadonlyArray<NormalizedProductMetadata>>
  > {
    try {
      const response = await this.query(
        "query DiscoverVaults($chainIds: [Int!]) {" +
          " vaults(first: 1000, where: { chainId_in: $chainIds }) {" +
          " items { address symbol name listed asset { address symbol decimals }" +
          " chain { id network } } } }",
        { chainIds: this.chainIds },
        vaultListResponseSchema
      );
      ensureGraphqlSuccess(response.errors);
      const fetchedAt = this.now().toISOString();
      return {
        kind: "OBSERVATION",
        value: response.data.vaults.items.map((vault) => toMetadata(vault, fetchedAt))
      };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  public async fetchProductMetadata(
    externalEntityId: string
  ): Promise<AdapterResult<NormalizedProductMetadata>> {
    try {
      const vaultId = parseExternalVaultId(externalEntityId);
      const response = await this.query(
        "query VaultIdentity($address: String!, $chainId: Int!) {" +
          " vaultByAddress(address: $address, chainId: $chainId) {" +
          " address symbol name listed asset { address symbol decimals } chain { id network } } }",
        { address: vaultId.address, chainId: vaultId.chainId },
        vaultResponseSchema
      );
      ensureGraphqlSuccess(response.errors);
      if (response.data.vaultByAddress === null) {
        return unavailable("VAULT_NOT_FOUND");
      }
      return {
        kind: "OBSERVATION",
        value: toMetadata(response.data.vaultByAddress, this.now().toISOString())
      };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  public async fetchYield(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>> {
    return this.fetchMetric(
      externalEntityId,
      "query VaultYield($address: String!, $chainId: Int!) {" +
        " vaultByAddress(address: $address, chainId: $chainId) {" +
        " address state { netApy } } }",
      vaultYieldResponseSchema,
      (response) => response.data.vaultByAddress?.state?.netApy ?? null,
      "YIELD",
      "DECIMAL_RATIO"
    );
  }

  public async fetchTVLOrAUM(
    externalEntityId: string
  ): Promise<AdapterResult<NormalizedObservation>> {
    return this.fetchMetric(
      externalEntityId,
      "query VaultAssets($address: String!, $chainId: Int!) {" +
        " vaultByAddress(address: $address, chainId: $chainId) {" +
        " address state { totalAssetsUsd } } }",
      vaultAssetsResponseSchema,
      (response) => response.data.vaultByAddress?.state?.totalAssetsUsd ?? null,
      "TVL",
      "USD"
    );
  }

  public async fetchLiquidity(
    externalEntityId: string
  ): Promise<AdapterResult<NormalizedObservation>> {
    return this.fetchMetric(
      externalEntityId,
      "query VaultLiquidity($address: String!, $chainId: Int!) {" +
        " vaultByAddress(address: $address, chainId: $chainId) {" +
        " address liquidity { usd } } }",
      vaultLiquidityResponseSchema,
      (response) => response.data.vaultByAddress?.liquidity?.usd ?? null,
      "LIQUIDITY",
      "USD"
    );
  }

  public async healthCheck(): Promise<AdapterHealth> {
    const startedAt = this.monotonicNow();
    const checkedAt = this.now().toISOString();
    try {
      const response = await this.query(
        "query AdapterHealth { __typename }",
        {},
        healthResponseSchema
      );
      ensureGraphqlSuccess(response.errors);
      return {
        adapterVersion: this.version,
        checkedAt,
        latencyMs: Math.max(0, this.monotonicNow() - startedAt),
        status: "HEALTHY"
      };
    } catch (error) {
      const failure = toAdapterFailure(error);
      return {
        adapterVersion: this.version,
        checkedAt,
        code: failure.code,
        latencyMs: Math.max(0, this.monotonicNow() - startedAt),
        status: failure.retryable ? "DEGRADED" : "UNAVAILABLE"
      };
    }
  }

  private async fetchMetric<TSchema extends z.ZodType>(
    externalEntityId: string,
    query: string,
    schema: TSchema,
    selectValue: (response: z.infer<TSchema>) => string | null,
    metric: NormalizedObservation["metric"],
    unit: string
  ): Promise<AdapterResult<NormalizedObservation>> {
    try {
      const vaultId = parseExternalVaultId(externalEntityId);
      const response = await this.query(
        query,
        { address: vaultId.address, chainId: vaultId.chainId },
        schema
      );
      const responseWithErrors = response as {
        readonly errors?: ReadonlyArray<unknown>;
      };
      ensureGraphqlSuccess(responseWithErrors.errors);
      const value = selectValue(response);
      if (value === null) {
        return unavailable("METRIC_NOT_AVAILABLE");
      }
      const fetchedAt = this.now().toISOString();
      return {
        kind: "OBSERVATION",
        value: normalizedObservationSchema.parse({
          adapterVersion: this.version,
          blockNumber: null,
          confidence: "DIRECT_API",
          externalEntityId,
          fetchedAt,
          metric,
          normalizedValue: value,
          observedAt: fetchedAt,
          rawValue: value,
          source: MORPHO_SOURCE,
          sourceRecordId: externalEntityId,
          status: "CURRENT",
          unit,
          verifiedAt: null,
          warnings: [
            "API metric requires canonical contract reconciliation before production selection."
          ]
        })
      };
    } catch (error) {
      return toAdapterFailure(error);
    }
  }

  private async query<TSchema extends z.ZodType>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    schema: TSchema
  ): Promise<z.infer<TSchema>> {
    const endpoint = new URL(this.endpoint);
    return this.circuitBreaker.execute(() =>
      safeFetchJson({
        init: {
          body: JSON.stringify({ query, variables }),
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
          maxResponseBytes: 1_000_000,
          resolver: this.options.resolver,
          timeoutMs: 10_000
        },
        schema,
        url: endpoint.toString()
      })
    );
  }
}

export { MORPHO_ADAPTER_VERSION, MORPHO_SOURCE };

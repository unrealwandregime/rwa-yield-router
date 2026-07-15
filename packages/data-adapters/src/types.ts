import { z } from "zod";

export const productCategorySchema = z.enum([
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
]);

export const yieldSourceSchema = z.enum([
  "TREASURY_COUPON",
  "MONEY_MARKET_INCOME",
  "BORROWER_INTEREST",
  "REPO_INCOME",
  "VAULT_STRATEGY",
  "STAKING_OR_PROTOCOL_REWARD",
  "TOKEN_INCENTIVE",
  "BASIS_OR_HEDGING_STRATEGY",
  "OTHER_VERIFIED",
  "NO_NATIVE_YIELD"
]);

export const sourceTypeSchema = z.enum([
  "OFFICIAL_API",
  "ONCHAIN",
  "OFFICIAL_DOCUMENT",
  "THIRD_PARTY_API",
  "MANUAL"
]);

export const confidenceSchema = z.enum([
  "VERIFIED_OFFICIAL",
  "DIRECT_API",
  "ONCHAIN_DERIVED",
  "ISSUER_REPORTED",
  "MANUALLY_VERIFIED",
  "THIRD_PARTY",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
]);

export const dataStatusSchema = z.enum([
  "CURRENT",
  "STALE",
  "ESTIMATED",
  "UNAVAILABLE",
  "CONFLICTED",
  "REJECTED"
]);

export const metricNameSchema = z.enum([
  "PRODUCT_METADATA",
  "YIELD",
  "TVL",
  "AUM",
  "LIQUIDITY",
  "PRICE",
  "NAV",
  "UTILIZATION",
  "HISTORICAL"
]);

export const normalizedSourceSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    type: sourceTypeSchema,
    url: z.url().refine((value) => new URL(value).protocol === "https:", {
      message: "Source URLs must use HTTPS"
    })
  })
  .strict();

export const normalizedObservationSchema = z
  .object({
    source: normalizedSourceSchema,
    externalEntityId: z.string().trim().min(1).max(256),
    metric: metricNameSchema,
    observedAt: z.iso.datetime({ offset: true }),
    fetchedAt: z.iso.datetime({ offset: true }),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
    confidence: confidenceSchema,
    rawValue: z.string().max(8_192).nullable(),
    normalizedValue: z.string().trim().min(1).max(512),
    unit: z.string().trim().min(1).max(64),
    status: dataStatusSchema,
    adapterVersion: z.string().trim().min(1).max(64),
    sourceRecordId: z.string().trim().min(1).max(256).nullable(),
    blockNumber: z.string().regex(/^\d+$/u).nullable(),
    warnings: z.array(z.string().trim().min(1).max(500)).max(20)
  })
  .strict();

export const normalizedProductMetadataSchema = z
  .object({
    externalId: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(200),
    symbol: z.string().trim().min(1).max(32),
    category: productCategorySchema,
    chainId: z.number().int().positive().nullable(),
    chainName: z.string().trim().min(1).max(80),
    contractAddress: z.string().trim().min(1).max(128).nullable(),
    underlyingAsset: z.string().trim().min(1).max(80),
    yieldSource: yieldSourceSchema,
    protocol: z.string().trim().min(1).max(100).nullable(),
    source: normalizedSourceSchema,
    observedAt: z.iso.datetime({ offset: true }),
    fetchedAt: z.iso.datetime({ offset: true }),
    confidence: confidenceSchema,
    adapterVersion: z.string().trim().min(1).max(64),
    warnings: z.array(z.string().trim().min(1).max(500)).max(20)
  })
  .strict();

export type ProductCategory = z.infer<typeof productCategorySchema>;
export type YieldSource = z.infer<typeof yieldSourceSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type DataStatus = z.infer<typeof dataStatusSchema>;
export type MetricName = z.infer<typeof metricNameSchema>;
export type NormalizedSource = z.infer<typeof normalizedSourceSchema>;
export type NormalizedObservation = z.infer<typeof normalizedObservationSchema>;
export type NormalizedProductMetadata = z.infer<typeof normalizedProductMetadataSchema>;

export type AdapterFailureKind = "UNAVAILABLE" | "UNSUPPORTED" | "REJECTED" | "DEGRADED";

export type AdapterResult<T> =
  | Readonly<{ kind: "OBSERVATION"; value: T }>
  | Readonly<{
      kind: AdapterFailureKind;
      code: string;
      message: string;
      retryable: boolean;
    }>;

export type AdapterHealth =
  | Readonly<{
      status: "HEALTHY";
      checkedAt: string;
      latencyMs: number;
      adapterVersion: string;
    }>
  | Readonly<{
      status: "DEGRADED" | "UNAVAILABLE";
      checkedAt: string;
      latencyMs: number;
      code: string;
      adapterVersion: string;
    }>;

export interface HistoricalRequest {
  readonly externalEntityId: string;
  readonly metric: MetricName;
  readonly start: string;
  readonly end: string;
}

export interface DataAdapter {
  readonly id: string;
  readonly version: string;
  discoverProducts?(): Promise<AdapterResult<ReadonlyArray<NormalizedProductMetadata>>>;
  fetchProductMetadata?(
    externalEntityId: string
  ): Promise<AdapterResult<NormalizedProductMetadata>>;
  fetchYield?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchTVLOrAUM?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchLiquidity?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchPrice?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchNAV?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchUtilization?(externalEntityId: string): Promise<AdapterResult<NormalizedObservation>>;
  fetchHistoricalData?(
    request: HistoricalRequest
  ): Promise<AdapterResult<ReadonlyArray<NormalizedObservation>>>;
  healthCheck(): Promise<AdapterHealth>;
}

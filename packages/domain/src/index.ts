import Decimal from "decimal.js";
import { z } from "zod";

export const PRODUCT_CATEGORIES = [
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
] as const;

export const productCategorySchema = z.enum(PRODUCT_CATEGORIES);
export type ProductCategory = z.infer<typeof productCategorySchema>;

export const YIELD_SOURCE_CLASSES = [
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
] as const;

export const yieldSourceClassSchema = z.enum(YIELD_SOURCE_CLASSES);
export type YieldSourceClass = z.infer<typeof yieldSourceClassSchema>;

export const RETURN_EXPOSURE_CLASSES = [
  "GOLD_PRICE",
  "MARKET_PRICE",
  "NAV_PREMIUM_OR_DISCOUNT",
  "FIAT_REFERENCE_VALUE",
  "COLLATERAL_PRICE",
  "NONE"
] as const;

export const returnExposureClassSchema = z.enum(RETURN_EXPOSURE_CLASSES);
export type ReturnExposureClass = z.infer<typeof returnExposureClassSchema>;

export const ACCESS_METHODS = [
  "ISSUER_MINT",
  "ISSUER_REDEMPTION",
  "DEX_PURCHASE",
  "LENDING_DEPOSIT",
  "VAULT_DEPOSIT",
  "OTHER_VERIFIED"
] as const;

export const accessMethodSchema = z.enum(ACCESS_METHODS);
export type AccessMethod = z.infer<typeof accessMethodSchema>;

export const CONFIDENCE_CLASSIFICATIONS = [
  "VERIFIED_OFFICIAL",
  "DIRECT_API",
  "ONCHAIN_DERIVED",
  "ISSUER_REPORTED",
  "THIRD_PARTY",
  "MANUALLY_VERIFIED",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
] as const;

export const confidenceClassificationSchema = z.enum(CONFIDENCE_CLASSIFICATIONS);
export type ConfidenceClassification = z.infer<typeof confidenceClassificationSchema>;

export const DATA_STATUSES = [
  "CURRENT",
  "UNKNOWN",
  "UNAVAILABLE",
  "ESTIMATED",
  "STALE",
  "AWAITING_VERIFICATION"
] as const;

export const dataStatusSchema = z.enum(DATA_STATUSES);
export type DataStatus = z.infer<typeof dataStatusSchema>;

export const LIFECYCLE_STATUSES = [
  "DRAFT",
  "REVIEWED",
  "PUBLISHED",
  "PAUSED",
  "CLOSED",
  "DEPRECATED",
  "UNAVAILABLE",
  "REJECTED",
  "ARCHIVED",
  "SUPERSEDED"
] as const;

export const lifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

export const ELIGIBILITY_STATUSES = [
  "ELIGIBLE",
  "INELIGIBLE",
  "CONDITIONAL",
  "UNKNOWN",
  "AWAITING_VERIFICATION"
] as const;

export const eligibilityStatusSchema = z.enum(ELIGIBILITY_STATUSES);
export type EligibilityStatus = z.infer<typeof eligibilityStatusSchema>;

export const INVESTOR_CLASSIFICATIONS = [
  "RETAIL",
  "ACCREDITED",
  "QUALIFIED",
  "PROFESSIONAL",
  "INSTITUTIONAL"
] as const;

export const investorClassificationSchema = z.enum(INVESTOR_CLASSIFICATIONS);
export type InvestorClassification = z.infer<typeof investorClassificationSchema>;

export const KYC_REQUIREMENTS = ["REQUIRED", "NOT_REQUIRED", "UNKNOWN"] as const;
export const kycRequirementSchema = z.enum(KYC_REQUIREMENTS);
export type KycRequirement = z.infer<typeof kycRequirementSchema>;

const PLAIN_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Canonical financial decimals are strings so binary floats cannot enter authoritative math. */
export function normalizeDecimal(value: string): string {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new Error("Financial decimal must be finite");
  }

  if (decimal.isZero()) {
    return "0";
  }

  return decimal.toFixed(decimal.decimalPlaces());
}

export const decimalStringSchema = z
  .string()
  .max(200, "Financial decimal exceeds the supported precision boundary")
  .regex(PLAIN_DECIMAL_PATTERN, "Expected a plain base-10 decimal string")
  .transform(normalizeDecimal);

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gte(0),
  "Expected a non-negative decimal"
);

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gt(0),
  "Expected a positive decimal"
);

export const percentagePointSchema = z
  .object({
    value: decimalStringSchema,
    unit: z.literal("PERCENTAGE_POINTS_APY")
  })
  .strict();

export const decimalRatioSchema = z
  .object({
    value: decimalStringSchema,
    unit: z.literal("DECIMAL_RATIO")
  })
  .strict();

export const basisPointSchema = z
  .object({
    value: decimalStringSchema,
    unit: z.literal("BASIS_POINTS")
  })
  .strict();

export const fiatAmountSchema = z
  .object({
    value: nonNegativeDecimalStringSchema,
    unit: z.literal("FIAT_AMOUNT"),
    currency: z.string().regex(/^[A-Z]{3}$/, "Expected an ISO-style three-letter currency")
  })
  .strict();

export const tokenAmountSchema = z
  .object({
    value: nonNegativeDecimalStringSchema,
    unit: z.literal("TOKEN_AMOUNT"),
    assetId: z.string().min(1).max(128)
  })
  .strict();

export const durationSchema = z.discriminatedUnion("unit", [
  z.object({ value: positiveDecimalStringSchema, unit: z.literal("DAYS") }).strict(),
  z.object({ value: positiveDecimalStringSchema, unit: z.literal("YEARS") }).strict()
]);

export const financialQuantitySchema = z.discriminatedUnion("unit", [
  percentagePointSchema,
  decimalRatioSchema,
  basisPointSchema,
  fiatAmountSchema,
  tokenAmountSchema,
  z.object({ value: positiveDecimalStringSchema, unit: z.literal("DAYS") }).strict(),
  z.object({ value: positiveDecimalStringSchema, unit: z.literal("YEARS") }).strict()
]);

export type FinancialQuantity = z.infer<typeof financialQuantitySchema>;

export const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Timestamp must be normalized to UTC");

const observedMetricValueSchema = z
  .object({
    status: z.enum(["CURRENT", "ESTIMATED", "STALE"]),
    value: decimalStringSchema
  })
  .strict();

const absentMetricValueSchema = z
  .object({
    status: z.enum(["UNKNOWN", "UNAVAILABLE", "AWAITING_VERIFICATION"])
  })
  .strict();

export const metricValueSchema = z.discriminatedUnion("status", [
  observedMetricValueSchema,
  absentMetricValueSchema
]);

export type MetricValue = z.infer<typeof metricValueSchema>;
export type ObservedMetricValue = z.infer<typeof observedMetricValueSchema>;

export function metricHasValue(metric: MetricValue): metric is ObservedMetricValue {
  return metric.status === "CURRENT" || metric.status === "ESTIMATED" || metric.status === "STALE";
}

export const sourceReferenceSchema = z
  .object({
    observationId: z.string().uuid(),
    sourceId: z.string().uuid(),
    canonicalUrl: z
      .url()
      .refine((value) => value.startsWith("https://"), "Source URL must use HTTPS"),
    observedAt: utcTimestampSchema,
    fetchedAt: utcTimestampSchema,
    verifiedAt: utcTimestampSchema.nullable(),
    confidence: confidenceClassificationSchema,
    dataStatus: dataStatusSchema,
    adapterVersion: z.string().min(1).max(64)
  })
  .strict();

export type SourceReference = z.infer<typeof sourceReferenceSchema>;

const idSchema = z.string().uuid();

export const productSchema = z
  .object({
    kind: z.literal("PRODUCT"),
    id: idSchema,
    name: z.string().min(1).max(160),
    symbol: z.string().min(1).max(32),
    category: productCategorySchema,
    lifecycle: lifecycleStatusSchema,
    nativeYieldSourceClass: yieldSourceClassSchema,
    verifiedNativeYieldMechanism: z.boolean(),
    nativeYieldObservationIds: z.array(idSchema)
  })
  .strict()
  .superRefine((product, context) => {
    if (
      product.category === "GOLD_BACKED_TOKEN" &&
      product.nativeYieldSourceClass !== "NO_NATIVE_YIELD" &&
      (!product.verifiedNativeYieldMechanism || product.nativeYieldObservationIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A gold-backed product needs sourced verification before declaring native yield",
        path: ["nativeYieldSourceClass"]
      });
    }
  });

export type Product = z.infer<typeof productSchema>;

export const routeSchema = z
  .object({
    kind: z.literal("ROUTE"),
    id: idSchema,
    productId: idSchema,
    name: z.string().min(1).max(160),
    accessMethod: accessMethodSchema,
    routeYieldSourceClass: yieldSourceClassSchema,
    lifecycle: lifecycleStatusSchema
  })
  .strict();

export type Route = z.infer<typeof routeSchema>;

export const yieldSourceSchema = z
  .object({
    kind: z.literal("YIELD_SOURCE"),
    id: idSchema,
    name: z.string().min(1).max(160),
    sourceClass: yieldSourceClassSchema
  })
  .strict();

export type YieldSource = z.infer<typeof yieldSourceSchema>;

export const returnExposureSchema = z
  .object({
    kind: z.literal("RETURN_EXPOSURE"),
    id: idSchema,
    productId: idSchema,
    exposureClass: returnExposureClassSchema,
    description: z.string().min(1).max(500)
  })
  .strict();

export type ReturnExposure = z.infer<typeof returnExposureSchema>;

export const accessPathSchema = z
  .object({
    kind: z.literal("ACCESS_PATH"),
    id: idSchema,
    routeId: idSchema,
    method: accessMethodSchema,
    eligibility: eligibilityStatusSchema,
    kyc: kycRequirementSchema
  })
  .strict();

export type AccessPath = z.infer<typeof accessPathSchema>;

export function isNativeGoldYieldCompliant(product: Product): boolean {
  if (product.category !== "GOLD_BACKED_TOKEN") {
    return true;
  }

  return (
    product.nativeYieldSourceClass === "NO_NATIVE_YIELD" ||
    (product.verifiedNativeYieldMechanism && product.nativeYieldObservationIds.length > 0)
  );
}

import {
  confidenceClassificationSchema,
  dataStatusSchema,
  decimalStringSchema,
  eligibilityStatusSchema,
  investorClassificationSchema,
  kycRequirementSchema,
  lifecycleStatusSchema,
  nonNegativeDecimalStringSchema,
  positiveDecimalStringSchema,
  productCategorySchema,
  utcTimestampSchema,
  yieldSourceClassSchema,
  type ConfidenceClassification,
  type ProductCategory
} from "@rwa-yield-router/domain";
import Decimal from "decimal.js";
import { z } from "zod";

export const ROUTING_PROFILES = [
  "CAPITAL_PRESERVATION",
  "CONSERVATIVE",
  "BALANCED",
  "YIELD_SEEKING",
  "CUSTOM"
] as const;

export const routingProfileSchema = z.enum(ROUTING_PROFILES);
export type RoutingProfile = z.infer<typeof routingProfileSchema>;

const percentageSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gte(0) && new Decimal(value).lte(100),
  "Expected a percentage between 0 and 100"
);

const canonicalConstraintShape = {
  maxProductAllocationPct: percentageSchema,
  maxIssuerExposurePct: percentageSchema,
  maxProtocolExposurePct: percentageSchema,
  maxChainExposurePct: percentageSchema,
  maxCategoryAllocationPct: percentageSchema,
  maxStablecoinExposurePct: percentageSchema,
  maxDefiExposurePct: percentageSchema,
  maxRwaExposurePct: percentageSchema,
  maxGoldExposurePct: percentageSchema,
  minImmediateLiquidityPct: percentageSchema,
  min24HourLiquidityPct: percentageSchema,
  min7DayLiquidityPct: percentageSchema,
  maxWeightedRiskScore: percentageSchema
} as const;

export const canonicalConstraintsSchema = z
  .object(canonicalConstraintShape)
  .strict()
  .superRefine((constraints, context) => {
    if (new Decimal(constraints.minImmediateLiquidityPct).gt(constraints.min24HourLiquidityPct)) {
      context.addIssue({
        code: "custom",
        message: "Immediate liquidity minimum cannot exceed the 24-hour minimum",
        path: ["minImmediateLiquidityPct"]
      });
    }
    if (new Decimal(constraints.min24HourLiquidityPct).gt(constraints.min7DayLiquidityPct)) {
      context.addIssue({
        code: "custom",
        message: "The 24-hour liquidity minimum cannot exceed the seven-day minimum",
        path: ["min24HourLiquidityPct"]
      });
    }
  });

export type CanonicalConstraints = z.infer<typeof canonicalConstraintsSchema>;

export const PROFILE_CONSTRAINTS = {
  CAPITAL_PRESERVATION: {
    maxProductAllocationPct: "25",
    maxIssuerExposurePct: "35",
    maxProtocolExposurePct: "20",
    maxChainExposurePct: "50",
    maxCategoryAllocationPct: "50",
    maxStablecoinExposurePct: "40",
    maxDefiExposurePct: "20",
    maxRwaExposurePct: "80",
    maxGoldExposurePct: "20",
    minImmediateLiquidityPct: "40",
    min24HourLiquidityPct: "70",
    min7DayLiquidityPct: "90",
    maxWeightedRiskScore: "40"
  },
  CONSERVATIVE: {
    maxProductAllocationPct: "30",
    maxIssuerExposurePct: "40",
    maxProtocolExposurePct: "30",
    maxChainExposurePct: "60",
    maxCategoryAllocationPct: "60",
    maxStablecoinExposurePct: "50",
    maxDefiExposurePct: "35",
    maxRwaExposurePct: "80",
    maxGoldExposurePct: "25",
    minImmediateLiquidityPct: "30",
    min24HourLiquidityPct: "60",
    min7DayLiquidityPct: "85",
    maxWeightedRiskScore: "50"
  },
  BALANCED: {
    maxProductAllocationPct: "40",
    maxIssuerExposurePct: "50",
    maxProtocolExposurePct: "40",
    maxChainExposurePct: "70",
    maxCategoryAllocationPct: "70",
    maxStablecoinExposurePct: "60",
    maxDefiExposurePct: "60",
    maxRwaExposurePct: "80",
    maxGoldExposurePct: "30",
    minImmediateLiquidityPct: "20",
    min24HourLiquidityPct: "50",
    min7DayLiquidityPct: "75",
    maxWeightedRiskScore: "65"
  },
  YIELD_SEEKING: {
    maxProductAllocationPct: "60",
    maxIssuerExposurePct: "70",
    maxProtocolExposurePct: "65",
    maxChainExposurePct: "80",
    maxCategoryAllocationPct: "85",
    maxStablecoinExposurePct: "80",
    maxDefiExposurePct: "85",
    maxRwaExposurePct: "90",
    maxGoldExposurePct: "50",
    minImmediateLiquidityPct: "10",
    min24HourLiquidityPct: "25",
    min7DayLiquidityPct: "50",
    maxWeightedRiskScore: "85"
  },
  CUSTOM: {
    maxProductAllocationPct: "100",
    maxIssuerExposurePct: "100",
    maxProtocolExposurePct: "100",
    maxChainExposurePct: "100",
    maxCategoryAllocationPct: "100",
    maxStablecoinExposurePct: "100",
    maxDefiExposurePct: "100",
    maxRwaExposurePct: "100",
    maxGoldExposurePct: "100",
    minImmediateLiquidityPct: "0",
    min24HourLiquidityPct: "0",
    min7DayLiquidityPct: "0",
    maxWeightedRiskScore: "100"
  }
} as const satisfies Record<RoutingProfile, CanonicalConstraints>;

const constraintOverridesSchema = z.object(canonicalConstraintShape).partial().strict().default({});

export function expandProfileConstraints(
  profile: RoutingProfile,
  overrides: z.input<typeof constraintOverridesSchema> = {}
): CanonicalConstraints {
  const parsedProfile = routingProfileSchema.parse(profile);
  const parsedOverrides = constraintOverridesSchema.parse(overrides);
  return canonicalConstraintsSchema.parse({
    ...PROFILE_CONSTRAINTS[parsedProfile],
    ...parsedOverrides
  });
}

export const simulationInputSchema = z
  .object({
    capitalUsd: positiveDecimalStringSchema,
    currentAssetId: z.string().min(1).max(128),
    currentChainId: z.string().min(1).max(128),
    holdingPeriodDays: positiveDecimalStringSchema,
    jurisdiction: z.string().min(2).max(64),
    investorClassification: investorClassificationSchema,
    kycAcceptable: z.boolean(),
    preferredChains: z.array(z.string().min(1).max(128)).default([]),
    excludedChains: z.array(z.string().min(1).max(128)).default([]),
    preferredAssets: z.array(z.string().min(1).max(128)).default([]),
    profile: routingProfileSchema,
    constraintOverrides: constraintOverridesSchema,
    minimumAumOrTvlUsd: nonNegativeDecimalStringSchema.default("0"),
    minimumAvailableLiquidityUsd: nonNegativeDecimalStringSchema.default("0"),
    incentiveYieldAcceptable: z.boolean(),
    minimumDataConfidence: confidenceClassificationSchema,
    excludedProductIds: z.array(z.string().min(1).max(128)).default([]),
    excludedProtocolIds: z.array(z.string().min(1).max(128)).default([]),
    excludedIssuerIds: z.array(z.string().min(1).max(128)).default([]),
    advancedResearchMode: z.boolean().default(false),
    asOf: utcTimestampSchema,
    calculationVersion: z.string().min(1).max(64).default("routing-calculation-v1.0.0"),
    methodologyVersion: z.string().min(1).max(64)
  })
  .strict();

export type SimulationInputRequest = z.input<typeof simulationInputSchema>;
export type SimulationInput = z.output<typeof simulationInputSchema>;

const eligibilitySchema = z
  .object({
    status: eligibilityStatusSchema,
    jurisdictions: z.array(z.string().min(1).max(64)),
    investorClassifications: z.array(investorClassificationSchema)
  })
  .strict();

const costScenarioSchema = z
  .object({
    originAssetId: z.string().min(1).max(128).nullable(),
    originChainId: z.string().min(1).max(128).nullable(),
    fixedCostUsd: nonNegativeDecimalStringSchema,
    slippageBps: nonNegativeDecimalStringSchema
  })
  .strict()
  .refine((scenario) => scenario.originAssetId !== null || scenario.originChainId !== null, {
    message: "A cost override must identify an origin asset, chain, or both"
  });

const transactionCostModelSchema = z
  .object({
    defaultFixedCostUsd: nonNegativeDecimalStringSchema,
    defaultSlippageBps: nonNegativeDecimalStringSchema,
    overrides: z.array(costScenarioSchema),
    status: z.enum(["AVAILABLE", "UNAVAILABLE"])
  })
  .strict()
  .superRefine((model, context) => {
    const keys = model.overrides.map(
      (override) => `${override.originAssetId ?? "*"}|${override.originChainId ?? "*"}`
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Transaction-cost overrides must be unique" });
    }
    if (
      model.status === "UNAVAILABLE" &&
      (!new Decimal(model.defaultFixedCostUsd).isZero() ||
        !new Decimal(model.defaultSlippageBps).isZero() ||
        model.overrides.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable transaction costs must not contain invented numeric estimates"
      });
    }
  });

const liquidityWindowsSchema = z
  .object({
    immediatePct: percentageSchema,
    within24HoursPct: percentageSchema,
    within7DaysPct: percentageSchema
  })
  .strict()
  .superRefine((liquidity, context) => {
    if (new Decimal(liquidity.immediatePct).gt(liquidity.within24HoursPct)) {
      context.addIssue({
        code: "custom",
        message: "Immediate liquidity cannot exceed 24-hour liquidity"
      });
    }
    if (new Decimal(liquidity.within24HoursPct).gt(liquidity.within7DaysPct)) {
      context.addIssue({
        code: "custom",
        message: "24-hour liquidity cannot exceed seven-day liquidity"
      });
    }
  });

const yieldSourceShareSchema = z
  .object({
    sourceClass: yieldSourceClassSchema,
    sharePct: percentageSchema
  })
  .strict();

export const routeCandidateSchema = z
  .object({
    routeId: z.string().min(1).max(128),
    productId: z.string().min(1).max(128),
    issuerId: z.string().min(1).max(128),
    protocolId: z.string().min(1).max(128).nullable(),
    chainId: z.string().min(1).max(128),
    category: productCategorySchema,
    underlyingAssetId: z.string().min(1).max(128),
    stablecoinId: z.string().min(1).max(128).nullable(),
    isDefi: z.boolean(),
    isRwa: z.boolean(),
    isGold: z.boolean(),
    grossApy: decimalStringSchema,
    netApyBeforeTransactionCosts: decimalStringSchema,
    comparativeRiskAdjustedApyBeforeTransactionCosts: decimalStringSchema,
    riskScore: percentageSchema,
    aumOrTvlUsd: nonNegativeDecimalStringSchema,
    availableLiquidityUsd: nonNegativeDecimalStringSchema,
    liquidity: liquidityWindowsSchema,
    incentiveApy: nonNegativeDecimalStringSchema,
    yieldSourceBreakdown: z.array(yieldSourceShareSchema).min(1),
    lifecycle: lifecycleStatusSchema,
    dataStatus: dataStatusSchema,
    verified: z.boolean(),
    confidence: confidenceClassificationSchema,
    eligibility: eligibilitySchema,
    kyc: kycRequirementSchema,
    transactionCosts: transactionCostModelSchema,
    sourceObservationIds: z.array(z.string().uuid()),
    dataTimestamp: utcTimestampSchema,
    methodologyVersion: z.string().min(1).max(64)
  })
  .strict()
  .superRefine((candidate, context) => {
    const shareTotal = candidate.yieldSourceBreakdown.reduce(
      (sum, share) => sum.plus(share.sharePct),
      new Decimal(0)
    );
    if (!shareTotal.eq(100)) {
      context.addIssue({
        code: "custom",
        message: `Yield-source shares total ${shareTotal.toString()}, not 100`,
        path: ["yieldSourceBreakdown"]
      });
    }
    if (candidate.category === "GOLD_BACKED_TOKEN" && !candidate.isGold) {
      context.addIssue({
        code: "custom",
        message: "Gold-backed category candidates must carry explicit gold exposure",
        path: ["isGold"]
      });
    }
  });

export type RouteCandidate = z.infer<typeof routeCandidateSchema>;

export const optimizationRequestSchema = z
  .object({
    input: simulationInputSchema,
    candidates: z.array(routeCandidateSchema).max(500)
  })
  .strict()
  .superRefine((request, context) => {
    const routeIds = request.candidates.map((candidate) => candidate.routeId);
    if (new Set(routeIds).size !== routeIds.length) {
      context.addIssue({
        code: "custom",
        message: "Candidate route IDs must be unique",
        path: ["candidates"]
      });
    }
  });

export type OptimizationRequest = z.input<typeof optimizationRequestSchema>;
export type CanonicalOptimizationRequest = z.output<typeof optimizationRequestSchema>;

export const CONFIDENCE_RANK: Record<ConfidenceClassification, number> = {
  UNAVAILABLE: 0,
  STALE: 1,
  ESTIMATED: 2,
  THIRD_PARTY: 3,
  ISSUER_REPORTED: 4,
  MANUALLY_VERIFIED: 5,
  DIRECT_API: 6,
  ONCHAIN_DERIVED: 7,
  VERIFIED_OFFICIAL: 8
};

export function confidenceMeetsMinimum(
  confidence: ConfidenceClassification,
  minimum: ConfidenceClassification
): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[minimum];
}

export interface CanonicalSimulationSnapshot {
  input: SimulationInput;
  constraints: CanonicalConstraints;
  category: ProductCategory | null;
}

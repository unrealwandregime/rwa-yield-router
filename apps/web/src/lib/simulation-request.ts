import {
  confidenceClassificationSchema,
  decimalStringSchema,
  investorClassificationSchema,
  positiveDecimalStringSchema
} from "@rwa-yield-router/domain";
import { routingProfileSchema } from "@rwa-yield-router/routing-engine";
import Decimal from "decimal.js";
import { z } from "zod";

const percentageSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gte(0) && new Decimal(value).lte(100),
  "Expected a percentage between 0 and 100"
);

export const simulationRequestSchema = z
  .object({
    advancedResearchMode: z.boolean().default(false),
    capital: positiveDecimalStringSchema,
    currentAsset: z.string().trim().min(1).max(128),
    currentChain: z.string().trim().min(1).max(128),
    holdingPeriodDays: positiveDecimalStringSchema,
    incentivesAcceptable: z.boolean(),
    investorClassification: investorClassificationSchema,
    jurisdiction: z
      .string()
      .trim()
      .regex(/^[a-z]{2}$/iu, "Expected a two-letter country code"),
    kycAcceptable: z.boolean(),
    maximumChainExposure: percentageSchema,
    maximumDefiExposure: percentageSchema,
    maximumGoldExposure: percentageSchema,
    maximumIssuerExposure: percentageSchema,
    maximumProductAllocation: percentageSchema,
    maximumProtocolExposure: percentageSchema,
    maximumRwaExposure: percentageSchema,
    minimumConfidence: confidenceClassificationSchema,
    minimumImmediateLiquidity: percentageSchema,
    minimumSevenDayLiquidity: percentageSchema,
    minimumTwentyFourHourLiquidity: percentageSchema,
    name: z.string().trim().min(1).max(120).optional(),
    preferredChains: z
      .array(z.string().trim().min(1).max(128))
      .max(20)
      .refine(
        (chains) => new Set(chains).size === chains.length,
        "Preferred chains must be unique."
      ),
    profile: routingProfileSchema,
    saveRequested: z.boolean().default(false)
  })
  .strict()
  .superRefine((request, context) => {
    if (new Decimal(request.minimumImmediateLiquidity).gt(request.minimumTwentyFourHourLiquidity)) {
      context.addIssue({
        code: "custom",
        message: "Immediate liquidity cannot exceed the 24-hour minimum.",
        path: ["minimumImmediateLiquidity"]
      });
    }
    if (new Decimal(request.minimumTwentyFourHourLiquidity).gt(request.minimumSevenDayLiquidity)) {
      context.addIssue({
        code: "custom",
        message: "The 24-hour liquidity minimum cannot exceed the seven-day minimum.",
        path: ["minimumTwentyFourHourLiquidity"]
      });
    }
  });

export type SimulationRequest = z.infer<typeof simulationRequestSchema>;

import {
  confidenceClassificationSchema,
  decimalStringSchema,
  metricHasValue,
  metricValueSchema,
  positiveDecimalStringSchema,
  utcTimestampSchema,
  yieldSourceClassSchema,
  type MetricValue,
  type ObservedMetricValue
} from "@rwa-yield-router/domain";
import Decimal from "decimal.js";
import { z } from "zod";

export const YIELD_CALCULATION_VERSION = "yield-v1.0.0";
export const DAY_COUNT_CONVENTIONS = ["ACTUAL_365_FIXED", "ACTUAL_ACTUAL_ISDA"] as const;
export const dayCountConventionSchema = z.enum(DAY_COUNT_CONVENTIONS);

export const YIELD_COMPONENT_KINDS = [
  "BASE",
  "BORROWER_PAID",
  "TREASURY_OR_MONEY_MARKET",
  "STRATEGY",
  "REWARD_TOKEN",
  "OTHER_INCENTIVE"
] as const;

export const yieldComponentKindSchema = z.enum(YIELD_COMPONENT_KINDS);

export const yieldComponentSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: yieldComponentKindSchema,
    yieldSourceClass: yieldSourceClassSchema,
    apy: metricValueSchema,
    unit: z.literal("PERCENTAGE_POINTS_APY"),
    compoundingConvention: z.enum(["SIMPLE_APY", "NOMINAL_APR"]),
    performanceFeeEligible: z.boolean(),
    variable: z.boolean(),
    promotional: z.boolean(),
    issuerReported: z.boolean(),
    startsAt: utcTimestampSchema.nullable(),
    endsAt: utcTimestampSchema.nullable(),
    observationWindowDays: positiveDecimalStringSchema.nullable(),
    confidence: confidenceClassificationSchema,
    observationIds: z.array(z.string().uuid()),
    asOf: utcTimestampSchema
  })
  .strict()
  .superRefine((component, context) => {
    if (
      component.startsAt !== null &&
      component.endsAt !== null &&
      Date.parse(component.endsAt) <= Date.parse(component.startsAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Component end must be after its start",
        path: ["endsAt"]
      });
    }

    if (
      (component.kind === "REWARD_TOKEN" || component.kind === "OTHER_INCENTIVE") &&
      !component.promotional
    ) {
      context.addIssue({
        code: "custom",
        message: "Incentive components must be identified as promotional",
        path: ["promotional"]
      });
    }
  });

export type YieldComponent = z.infer<typeof yieldComponentSchema>;

const nonNegativeMetricValueSchema = metricValueSchema.refine(
  (metric) => !metricHasValue(metric) || new Decimal(metric.value).gte(0),
  "Fees and transaction costs cannot be negative"
);

const performanceFeeMetricSchema = nonNegativeMetricValueSchema.refine(
  (metric) => !metricHasValue(metric) || new Decimal(metric.value).lte(100),
  "Performance fee cannot exceed 100% of eligible positive yield"
);

const recurringFeeSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(["MANAGEMENT", "PROTOCOL"]),
    rate: nonNegativeMetricValueSchema,
    unit: z.literal("PERCENTAGE_POINTS_APY"),
    observationIds: z.array(z.string().uuid())
  })
  .strict();

const performanceFeeSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.literal("PERFORMANCE"),
    rate: performanceFeeMetricSchema,
    unit: z.literal("PERCENT_OF_ELIGIBLE_POSITIVE_YIELD"),
    observationIds: z.array(z.string().uuid())
  })
  .strict();

export const feeComponentSchema = z.discriminatedUnion("kind", [
  recurringFeeSchema,
  performanceFeeSchema
]);
export type FeeComponent = z.infer<typeof feeComponentSchema>;

export const TRANSACTION_COST_KINDS = ["ENTRY", "EXIT", "GAS", "SLIPPAGE"] as const;

export const transactionCostSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(TRANSACTION_COST_KINDS),
    amount: nonNegativeMetricValueSchema,
    unit: z.literal("USD"),
    estimated: z.boolean(),
    observationIds: z.array(z.string().uuid())
  })
  .strict();

export type TransactionCost = z.infer<typeof transactionCostSchema>;

export const calculationHorizonSchema = z
  .object({
    startsAt: utcTimestampSchema,
    endsAt: utcTimestampSchema,
    dayCountConvention: dayCountConventionSchema
  })
  .strict()
  .refine((horizon) => Date.parse(horizon.endsAt) > Date.parse(horizon.startsAt), {
    message: "Calculation horizon must be positive",
    path: ["endsAt"]
  });

export const yieldCalculationInputSchema = z
  .object({
    capitalUsd: positiveDecimalStringSchema,
    horizon: calculationHorizonSchema,
    components: z.array(yieldComponentSchema).min(1),
    fees: z.array(feeComponentSchema),
    transactionCosts: z.array(transactionCostSchema),
    calculatedAt: utcTimestampSchema,
    calculationVersion: z.string().min(1).max(64).default(YIELD_CALCULATION_VERSION)
  })
  .strict();

export type YieldCalculationInput = z.input<typeof yieldCalculationInputSchema>;
export type CanonicalYieldCalculationInput = z.output<typeof yieldCalculationInputSchema>;

export const YIELD_WARNING_CODES = [
  "ESTIMATED_INPUT",
  "STALE_INPUT",
  "UNKNOWN_YIELD_COMPONENT",
  "UNKNOWN_FEE",
  "UNKNOWN_TRANSACTION_COST",
  "VARIABLE_YIELD",
  "ISSUER_REPORTED_YIELD",
  "SHORT_OBSERVATION_WINDOW",
  "INCENTIVE_EXPIRED",
  "INCENTIVE_ENDS_DURING_HORIZON",
  "INCENTIVE_END_UNKNOWN"
] as const;

export type YieldWarningCode = (typeof YIELD_WARNING_CODES)[number];

export interface YieldComponentContribution {
  id: string;
  kind: YieldComponent["kind"];
  sourceClass: YieldComponent["yieldSourceClass"];
  statedApy: string | null;
  effectiveApy: string | null;
  status: MetricValue["status"];
  activeHorizonRatio: string;
}

interface YieldCalculationCommon {
  calculationVersion: string;
  calculatedAt: string;
  inputHash: string;
  grossApy: string | null;
  knownNetApy: string | null;
  recurringFeeApy: string;
  expectedPerformanceFeeApy: string;
  annualizedTransactionCostApy: string;
  componentContributions: YieldComponentContribution[];
  observationIds: string[];
  warnings: YieldWarningCode[];
}

export interface CompleteYieldCalculation extends YieldCalculationCommon {
  status: "COMPLETE" | "QUALIFIED";
  netApy: string;
}

export interface PartialYieldCalculation extends YieldCalculationCommon {
  status: "PARTIAL";
  netApy: null;
  missingInputIds: string[];
}

export interface UnavailableYieldCalculation extends YieldCalculationCommon {
  status: "UNAVAILABLE";
  netApy: null;
  reason: "NO_AVAILABLE_YIELD" | "INCOMPATIBLE_COMPONENT";
  missingInputIds: string[];
}

export type YieldCalculationResult =
  CompleteYieldCalculation | PartialYieldCalculation | UnavailableYieldCalculation;

const MILLISECONDS_PER_DAY = new Decimal(86_400_000);

function decimalText(value: Decimal): string {
  if (value.isZero()) {
    return "0";
  }

  return value.toFixed(value.decimalPlaces());
}

function elapsedDays(startsAt: string, endsAt: string): Decimal {
  return new Decimal(Date.parse(endsAt)).minus(Date.parse(startsAt)).div(MILLISECONDS_PER_DAY);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function calculateYearFraction(
  startsAt: string,
  endsAt: string,
  convention: z.infer<typeof dayCountConventionSchema>
): Decimal {
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("Calculation horizon must be positive");
  }

  if (convention === "ACTUAL_365_FIXED") {
    return elapsedDays(startsAt, endsAt).div(365);
  }

  let cursor = new Date(startsAt);
  const end = new Date(endsAt);
  let fraction = new Decimal(0);

  while (cursor < end) {
    const year = cursor.getUTCFullYear();
    const nextYear = new Date(Date.UTC(year + 1, 0, 1));
    const segmentEnd = nextYear < end ? nextYear : end;
    const segmentDays = new Decimal(segmentEnd.getTime())
      .minus(cursor.getTime())
      .div(MILLISECONDS_PER_DAY);
    fraction = fraction.plus(segmentDays.div(isLeapYear(year) ? 366 : 365));
    cursor = segmentEnd;
  }

  return fraction;
}

export function annualizeTransactionCostRate(
  totalCostUsd: string,
  capitalUsd: string,
  yearFraction: Decimal
): Decimal {
  const capital = new Decimal(capitalUsd);
  if (!capital.isFinite() || capital.lte(0)) {
    throw new Error("Capital must be a positive finite decimal");
  }
  if (!yearFraction.isFinite() || yearFraction.lte(0)) {
    throw new Error("Holding-period year fraction must be positive");
  }

  return new Decimal(totalCostUsd).div(capital).mul(100).div(yearFraction);
}

function incentiveRatio(component: YieldComponent, startsAt: string, endsAt: string): Decimal {
  const horizonStart = Date.parse(startsAt);
  const horizonEnd = Date.parse(endsAt);
  const activeStart =
    component.startsAt === null
      ? horizonStart
      : Math.max(horizonStart, Date.parse(component.startsAt));
  const activeEnd =
    component.endsAt === null ? horizonEnd : Math.min(horizonEnd, Date.parse(component.endsAt));

  if (activeEnd <= activeStart) {
    return new Decimal(0);
  }

  return new Decimal(activeEnd - activeStart).div(horizonEnd - horizonStart);
}

function isIncentive(component: YieldComponent): boolean {
  return component.kind === "REWARD_TOKEN" || component.kind === "OTHER_INCENTIVE";
}

function collectMetricWarnings(
  metric: MetricValue,
  warnings: Set<YieldWarningCode>,
  missingWarning: YieldWarningCode
): metric is ObservedMetricValue {
  if (!metricHasValue(metric)) {
    warnings.add(missingWarning);
    return false;
  }
  if (metric.status === "ESTIMATED") {
    warnings.add("ESTIMATED_INPUT");
  }
  if (metric.status === "STALE") {
    warnings.add("STALE_INPUT");
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(value);
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

export function deterministicHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function canonicalizeInput(input: CanonicalYieldCalculationInput): CanonicalYieldCalculationInput {
  return {
    ...input,
    components: [...input.components].sort((left, right) => left.id.localeCompare(right.id)),
    fees: [...input.fees].sort((left, right) => left.id.localeCompare(right.id)),
    transactionCosts: [...input.transactionCosts].sort((left, right) =>
      left.id.localeCompare(right.id)
    )
  };
}

export function calculateNetApy(rawInput: YieldCalculationInput): YieldCalculationResult {
  const input = canonicalizeInput(yieldCalculationInputSchema.parse(rawInput));
  const inputHash = deterministicHash(input);
  const warnings = new Set<YieldWarningCode>();
  const missingInputIds = new Set<string>();
  const observationIds = new Set<string>();

  for (const component of input.components) {
    for (const observationId of component.observationIds) {
      observationIds.add(observationId);
    }
  }
  for (const fee of input.fees) {
    for (const observationId of fee.observationIds) {
      observationIds.add(observationId);
    }
  }
  for (const cost of input.transactionCosts) {
    for (const observationId of cost.observationIds) {
      observationIds.add(observationId);
    }
  }

  const commonBase = {
    calculationVersion: input.calculationVersion,
    calculatedAt: input.calculatedAt,
    inputHash,
    observationIds: [...observationIds].sort()
  };

  if (input.components.some((component) => component.compoundingConvention !== "SIMPLE_APY")) {
    return {
      ...commonBase,
      status: "UNAVAILABLE",
      reason: "INCOMPATIBLE_COMPONENT",
      grossApy: null,
      knownNetApy: null,
      netApy: null,
      recurringFeeApy: "0",
      expectedPerformanceFeeApy: "0",
      annualizedTransactionCostApy: "0",
      componentContributions: [],
      warnings: [],
      missingInputIds: []
    };
  }

  let grossApy = new Decimal(0);
  let performanceFeeEligibleApy = new Decimal(0);
  let availableYieldCount = 0;
  const contributions: YieldComponentContribution[] = [];

  for (const component of input.components) {
    if (!collectMetricWarnings(component.apy, warnings, "UNKNOWN_YIELD_COMPONENT")) {
      missingInputIds.add(component.id);
      contributions.push({
        id: component.id,
        kind: component.kind,
        sourceClass: component.yieldSourceClass,
        statedApy: null,
        effectiveApy: null,
        status: component.apy.status,
        activeHorizonRatio: "0"
      });
      continue;
    }

    availableYieldCount += 1;
    const ratio = isIncentive(component)
      ? incentiveRatio(component, input.horizon.startsAt, input.horizon.endsAt)
      : new Decimal(1);
    const statedApy = new Decimal(component.apy.value);
    const effectiveApy = statedApy.mul(ratio);
    grossApy = grossApy.plus(effectiveApy);

    if (component.performanceFeeEligible && effectiveApy.gt(0)) {
      performanceFeeEligibleApy = performanceFeeEligibleApy.plus(effectiveApy);
    }
    if (component.variable) {
      warnings.add("VARIABLE_YIELD");
    }
    if (component.issuerReported) {
      warnings.add("ISSUER_REPORTED_YIELD");
    }
    if (
      component.observationWindowDays !== null &&
      new Decimal(component.observationWindowDays).lt(30)
    ) {
      warnings.add("SHORT_OBSERVATION_WINDOW");
    }
    if (isIncentive(component)) {
      if (ratio.isZero()) {
        warnings.add("INCENTIVE_EXPIRED");
      } else if (ratio.lt(1)) {
        warnings.add("INCENTIVE_ENDS_DURING_HORIZON");
      } else if (component.endsAt === null) {
        warnings.add("INCENTIVE_END_UNKNOWN");
      }
    }

    contributions.push({
      id: component.id,
      kind: component.kind,
      sourceClass: component.yieldSourceClass,
      statedApy: decimalText(statedApy),
      effectiveApy: decimalText(effectiveApy),
      status: component.apy.status,
      activeHorizonRatio: decimalText(ratio)
    });
  }

  if (availableYieldCount === 0) {
    return {
      ...commonBase,
      status: "UNAVAILABLE",
      reason: "NO_AVAILABLE_YIELD",
      grossApy: null,
      knownNetApy: null,
      netApy: null,
      recurringFeeApy: "0",
      expectedPerformanceFeeApy: "0",
      annualizedTransactionCostApy: "0",
      componentContributions: contributions,
      warnings: [...warnings].sort(),
      missingInputIds: [...missingInputIds].sort()
    };
  }

  let recurringFeeApy = new Decimal(0);
  let performanceFeeApy = new Decimal(0);
  for (const fee of input.fees) {
    if (!collectMetricWarnings(fee.rate, warnings, "UNKNOWN_FEE")) {
      missingInputIds.add(fee.id);
      continue;
    }
    if (fee.kind === "PERFORMANCE") {
      performanceFeeApy = performanceFeeApy.plus(
        performanceFeeEligibleApy.mul(fee.rate.value).div(100)
      );
    } else {
      recurringFeeApy = recurringFeeApy.plus(fee.rate.value);
    }
  }

  let knownTransactionCostUsd = new Decimal(0);
  for (const cost of input.transactionCosts) {
    if (!collectMetricWarnings(cost.amount, warnings, "UNKNOWN_TRANSACTION_COST")) {
      missingInputIds.add(cost.id);
      continue;
    }
    knownTransactionCostUsd = knownTransactionCostUsd.plus(cost.amount.value);
    if (cost.estimated) {
      warnings.add("ESTIMATED_INPUT");
    }
  }

  const yearFraction = calculateYearFraction(
    input.horizon.startsAt,
    input.horizon.endsAt,
    input.horizon.dayCountConvention
  );
  const annualizedTransactionCostApy = annualizeTransactionCostRate(
    decimalText(knownTransactionCostUsd),
    input.capitalUsd,
    yearFraction
  );
  const knownNetApy = grossApy
    .minus(recurringFeeApy)
    .minus(performanceFeeApy)
    .minus(annualizedTransactionCostApy);

  const common = {
    ...commonBase,
    grossApy: decimalText(grossApy),
    knownNetApy: decimalText(knownNetApy),
    recurringFeeApy: decimalText(recurringFeeApy),
    expectedPerformanceFeeApy: decimalText(performanceFeeApy),
    annualizedTransactionCostApy: decimalText(annualizedTransactionCostApy),
    componentContributions: contributions,
    warnings: [...warnings].sort()
  };

  if (missingInputIds.size > 0) {
    return {
      ...common,
      status: "PARTIAL",
      netApy: null,
      missingInputIds: [...missingInputIds].sort()
    };
  }

  return {
    ...common,
    status: warnings.size === 0 ? "COMPLETE" : "QUALIFIED",
    netApy: decimalText(knownNetApy)
  };
}

export function formatApyForDisplay(value: string, decimalPlaces = 2): string {
  return new Decimal(decimalStringSchema.parse(value))
    .toDecimalPlaces(decimalPlaces)
    .toFixed(decimalPlaces);
}

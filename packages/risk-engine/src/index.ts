import {
  confidenceClassificationSchema,
  decimalStringSchema,
  metricHasValue,
  metricValueSchema,
  productCategorySchema,
  utcTimestampSchema,
  type MetricValue,
  type ProductCategory
} from "@rwa-yield-router/domain";
import Decimal from "decimal.js";
import { z } from "zod";

export const RISK_FACTORS = [
  "LIQUIDITY",
  "REDEMPTION",
  "ISSUER_OR_COUNTERPARTY",
  "CUSTODY",
  "SMART_CONTRACT",
  "ORACLE",
  "CHAIN",
  "STABLECOIN_OR_DEPEG",
  "MARKET_PRICE",
  "CONCENTRATION",
  "YIELD_INSTABILITY",
  "INCENTIVE_DEPENDENCY",
  "GOVERNANCE_AND_UPGRADEABILITY",
  "OPERATIONAL",
  "LEGAL_AND_ELIGIBILITY_UNCERTAINTY",
  "DATA_QUALITY"
] as const;

export const riskFactorSchema = z.enum(RISK_FACTORS);
export type RiskFactor = z.infer<typeof riskFactorSchema>;

const boundedScoreSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gte(0) && new Decimal(value).lte(100),
  "Risk score must be between 0 and 100"
);

const percentageWeightSchema = decimalStringSchema.refine(
  (value) => new Decimal(value).gte(0) && new Decimal(value).lte(100),
  "Weight must be between 0 and 100"
);

const factorCommonShape = {
  factor: riskFactorSchema,
  explanation: z.string().min(1).max(2_000),
  inputMetrics: z.array(z.string().min(1).max(128)),
  sourceObservationIds: z.array(z.string().uuid()),
  confidence: confidenceClassificationSchema,
  evidenceCoveragePct: boundedScoreSchema,
  calculatedAt: utcTimestampSchema,
  methodologyVersion: z.string().min(1).max(64)
} as const;

const availableRiskFactorSchema = z
  .object({
    ...factorCommonShape,
    status: z.literal("AVAILABLE"),
    score: boundedScoreSchema
  })
  .strict()
  .refine((factor) => factor.confidence !== "UNAVAILABLE", {
    message: "An available factor cannot have unavailable confidence",
    path: ["confidence"]
  });

const unavailableRiskFactorSchema = z
  .object({
    ...factorCommonShape,
    status: z.literal("UNAVAILABLE"),
    score: z.null()
  })
  .strict();

const notApplicableRiskFactorSchema = z
  .object({
    ...factorCommonShape,
    status: z.literal("NOT_APPLICABLE"),
    score: z.null()
  })
  .strict();

export const riskFactorResultSchema = z.discriminatedUnion("status", [
  availableRiskFactorSchema,
  unavailableRiskFactorSchema,
  notApplicableRiskFactorSchema
]);

export type RiskFactorResult = z.infer<typeof riskFactorResultSchema>;

const factorMetricSchema = z
  .object({
    id: z.string().min(1).max(128),
    score: metricValueSchema
      .refine(
        (metric) => !metricHasValue(metric) || new Decimal(metric.value).lte(100),
        "Input risk score must not exceed 100"
      )
      .refine(
        (metric) => !metricHasValue(metric) || new Decimal(metric.value).gte(0),
        "Input risk score must not be negative"
      ),
    weight: percentageWeightSchema.refine(
      (value) => new Decimal(value).gt(0),
      "Weight must be positive"
    ),
    required: z.boolean(),
    observationIds: z.array(z.string().uuid())
  })
  .strict();

export const factorScoringInputSchema = z
  .object({
    factor: riskFactorSchema,
    metrics: z.array(factorMetricSchema).min(1),
    minimumCoveragePct: boundedScoreSchema,
    explanation: z.string().min(1).max(2_000),
    confidence: confidenceClassificationSchema,
    calculatedAt: utcTimestampSchema,
    methodologyVersion: z.string().min(1).max(64)
  })
  .strict();

export type FactorScoringInput = z.input<typeof factorScoringInputSchema>;

function decimalText(value: Decimal): string {
  if (value.isZero()) {
    return "0";
  }
  return value.toFixed(value.decimalPlaces());
}

export function scoreRiskFactor(rawInput: FactorScoringInput): RiskFactorResult {
  const input = factorScoringInputSchema.parse(rawInput);
  const totalWeight = input.metrics.reduce(
    (sum, metric) => sum.plus(metric.weight),
    new Decimal(0)
  );
  const availableMetrics = input.metrics.filter((metric) => metricHasValue(metric.score));
  const availableWeight = availableMetrics.reduce(
    (sum, metric) => sum.plus(metric.weight),
    new Decimal(0)
  );
  const coverage = availableWeight.div(totalWeight).mul(100);
  const missingRequired = input.metrics.some(
    (metric) => metric.required && !metricHasValue(metric.score)
  );
  const sourceObservationIds = [
    ...new Set(input.metrics.flatMap((metric) => metric.observationIds))
  ].sort();
  const inputMetrics = input.metrics.map((metric) => metric.id).sort();

  const common = {
    factor: input.factor,
    explanation: input.explanation,
    inputMetrics,
    sourceObservationIds,
    confidence: input.confidence,
    evidenceCoveragePct: decimalText(coverage),
    calculatedAt: input.calculatedAt,
    methodologyVersion: input.methodologyVersion
  };

  if (missingRequired || coverage.lt(input.minimumCoveragePct)) {
    return { ...common, status: "UNAVAILABLE", score: null };
  }

  const weightedScore = availableMetrics.reduce((sum, metric) => {
    if (!metricHasValue(metric.score)) {
      return sum;
    }
    return sum.plus(new Decimal(metric.score.value).mul(metric.weight));
  }, new Decimal(0));
  const score = Decimal.max(0, Decimal.min(100, weightedScore.div(availableWeight)));
  return { ...common, status: "AVAILABLE", score: decimalText(score) };
}

export type CategoryWeights = Record<RiskFactor, string>;

export const CATEGORY_WEIGHTS_V1 = {
  TOKENIZED_TBILL: {
    LIQUIDITY: "15",
    REDEMPTION: "15",
    ISSUER_OR_COUNTERPARTY: "18",
    CUSTODY: "15",
    SMART_CONTRACT: "5",
    ORACLE: "1",
    CHAIN: "2",
    STABLECOIN_OR_DEPEG: "0",
    MARKET_PRICE: "7",
    CONCENTRATION: "5",
    YIELD_INSTABILITY: "1",
    INCENTIVE_DEPENDENCY: "0",
    GOVERNANCE_AND_UPGRADEABILITY: "1",
    OPERATIONAL: "1",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "10",
    DATA_QUALITY: "4"
  },
  STABLECOIN_VAULT: {
    LIQUIDITY: "14",
    REDEMPTION: "1",
    ISSUER_OR_COUNTERPARTY: "2",
    CUSTODY: "2",
    SMART_CONTRACT: "18",
    ORACLE: "2",
    CHAIN: "2",
    STABLECOIN_OR_DEPEG: "12",
    MARKET_PRICE: "3",
    CONCENTRATION: "10",
    YIELD_INSTABILITY: "10",
    INCENTIVE_DEPENDENCY: "8",
    GOVERNANCE_AND_UPGRADEABILITY: "6",
    OPERATIONAL: "6",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "1",
    DATA_QUALITY: "3"
  },
  DEFI_LENDING: {
    LIQUIDITY: "14",
    REDEMPTION: "2",
    ISSUER_OR_COUNTERPARTY: "8",
    CUSTODY: "2",
    SMART_CONTRACT: "17",
    ORACLE: "10",
    CHAIN: "5",
    STABLECOIN_OR_DEPEG: "8",
    MARKET_PRICE: "6",
    CONCENTRATION: "6",
    YIELD_INSTABILITY: "5",
    INCENTIVE_DEPENDENCY: "3",
    GOVERNANCE_AND_UPGRADEABILITY: "6",
    OPERATIONAL: "2",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "1",
    DATA_QUALITY: "5"
  },
  MONEY_MARKET_TOKEN: {
    LIQUIDITY: "14",
    REDEMPTION: "15",
    ISSUER_OR_COUNTERPARTY: "16",
    CUSTODY: "14",
    SMART_CONTRACT: "6",
    ORACLE: "1",
    CHAIN: "2",
    STABLECOIN_OR_DEPEG: "2",
    MARKET_PRICE: "5",
    CONCENTRATION: "5",
    YIELD_INSTABILITY: "3",
    INCENTIVE_DEPENDENCY: "0",
    GOVERNANCE_AND_UPGRADEABILITY: "1",
    OPERATIONAL: "4",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "8",
    DATA_QUALITY: "4"
  },
  GOLD_BACKED_TOKEN: {
    LIQUIDITY: "14",
    REDEMPTION: "12",
    ISSUER_OR_COUNTERPARTY: "14",
    CUSTODY: "16",
    SMART_CONTRACT: "5",
    ORACLE: "4",
    CHAIN: "3",
    STABLECOIN_OR_DEPEG: "0",
    MARKET_PRICE: "10",
    CONCENTRATION: "4",
    YIELD_INSTABILITY: "2",
    INCENTIVE_DEPENDENCY: "1",
    GOVERNANCE_AND_UPGRADEABILITY: "2",
    OPERATIONAL: "4",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "6",
    DATA_QUALITY: "3"
  },
  CASH_EQUIVALENT: {
    LIQUIDITY: "15",
    REDEMPTION: "10",
    ISSUER_OR_COUNTERPARTY: "12",
    CUSTODY: "8",
    SMART_CONTRACT: "10",
    ORACLE: "4",
    CHAIN: "5",
    STABLECOIN_OR_DEPEG: "10",
    MARKET_PRICE: "3",
    CONCENTRATION: "5",
    YIELD_INSTABILITY: "5",
    INCENTIVE_DEPENDENCY: "3",
    GOVERNANCE_AND_UPGRADEABILITY: "3",
    OPERATIONAL: "3",
    LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "2",
    DATA_QUALITY: "2"
  }
} as const satisfies Record<ProductCategory, CategoryWeights>;

const categoryWeightSetSchema = z
  .record(riskFactorSchema, percentageWeightSchema)
  .superRefine((weights, context) => {
    const missing = RISK_FACTORS.filter((factor) => weights[factor] === undefined);
    if (missing.length > 0) {
      context.addIssue({ code: "custom", message: `Missing factors: ${missing.join(", ")}` });
      return;
    }
    const total = RISK_FACTORS.reduce(
      (sum, factor) => sum.plus(weights[factor] ?? "0"),
      new Decimal(0)
    );
    if (!total.eq(100)) {
      context.addIssue({
        code: "custom",
        message: `Category weights total ${total.toString()}, not 100`
      });
    }
  });

const categoryWeightsSchema = z.record(productCategorySchema, categoryWeightSetSchema);

export const riskMethodologySchema = z
  .object({
    id: z.string().uuid(),
    semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    status: z.enum(["DRAFT", "REVIEWED", "PUBLISHED", "SUPERSEDED"]),
    unknownRiskProxy: boundedScoreSchema,
    minimumEvidenceCoveragePct: boundedScoreSchema,
    maxAnnualPenaltyPp: percentageWeightSchema,
    categoryWeights: categoryWeightsSchema,
    createdAt: utcTimestampSchema,
    publishedAt: utcTimestampSchema.nullable(),
    effectiveAt: utcTimestampSchema.nullable(),
    authorId: z.string().min(1).max(128),
    reviewerId: z.string().min(1).max(128).nullable(),
    releaseNotes: z.string().min(1).max(2_000)
  })
  .strict()
  .superRefine((methodology, context) => {
    for (const category of productCategorySchema.options) {
      if (methodology.categoryWeights[category] === undefined) {
        context.addIssue({
          code: "custom",
          message: `Methodology is missing category ${category}`,
          path: ["categoryWeights", category]
        });
      }
    }
    if (
      methodology.status === "PUBLISHED" &&
      (methodology.publishedAt === null ||
        methodology.effectiveAt === null ||
        methodology.reviewerId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Published methodologies require reviewer, publish time, and effective time"
      });
    }
  });

export type RiskMethodology = z.infer<typeof riskMethodologySchema>;

function freezeMethodology(methodology: RiskMethodology): RiskMethodology {
  const categoryWeights: RiskMethodology["categoryWeights"] = {
    TOKENIZED_TBILL: Object.freeze({ ...methodology.categoryWeights.TOKENIZED_TBILL }),
    STABLECOIN_VAULT: Object.freeze({ ...methodology.categoryWeights.STABLECOIN_VAULT }),
    DEFI_LENDING: Object.freeze({ ...methodology.categoryWeights.DEFI_LENDING }),
    MONEY_MARKET_TOKEN: Object.freeze({ ...methodology.categoryWeights.MONEY_MARKET_TOKEN }),
    GOLD_BACKED_TOKEN: Object.freeze({ ...methodology.categoryWeights.GOLD_BACKED_TOKEN }),
    CASH_EQUIVALENT: Object.freeze({ ...methodology.categoryWeights.CASH_EQUIVALENT })
  };

  return Object.freeze({ ...methodology, categoryWeights: Object.freeze(categoryWeights) });
}

export const RISK_METHODOLOGY_V1 = freezeMethodology(
  riskMethodologySchema.parse({
    id: "10000000-0000-4000-8000-000000000101",
    semanticVersion: "1.0.0",
    status: "PUBLISHED",
    unknownRiskProxy: "75",
    minimumEvidenceCoveragePct: "70",
    maxAnnualPenaltyPp: "12",
    categoryWeights: CATEGORY_WEIGHTS_V1,
    createdAt: "2026-07-13T00:00:00Z",
    publishedAt: "2026-07-13T00:00:00Z",
    effectiveAt: "2026-07-13T00:00:00Z",
    authorId: "initial-methodology-author",
    reviewerId: "initial-methodology-reviewer",
    releaseNotes: "Initial published category weights, unknown proxy, and quadratic penalty curve."
  })
);

export interface PublishMethodologyInput {
  reviewerId: string;
  publishedAt: string;
  effectiveAt: string;
}

export function publishMethodology(
  rawDraft: RiskMethodology,
  publication: PublishMethodologyInput
): RiskMethodology {
  const draft = riskMethodologySchema.parse(rawDraft);
  if (draft.status === "PUBLISHED" || draft.status === "SUPERSEDED") {
    throw new RiskEngineError(
      "IMMUTABLE_METHODOLOGY",
      "Published methodologies cannot be republished or edited"
    );
  }

  return freezeMethodology(
    riskMethodologySchema.parse({
      ...structuredClone(draft),
      status: "PUBLISHED",
      reviewerId: publication.reviewerId,
      publishedAt: publication.publishedAt,
      effectiveAt: publication.effectiveAt
    })
  );
}

export const RISK_BANDS = [
  { maximum: "20", code: "LOW", label: "Low comparative risk" },
  { maximum: "40", code: "LOW_TO_MODERATE", label: "Low to moderate comparative risk" },
  { maximum: "60", code: "MODERATE", label: "Moderate comparative risk" },
  { maximum: "80", code: "HIGH", label: "High comparative risk" },
  { maximum: "100", code: "VERY_HIGH", label: "Very high comparative risk" }
] as const;

export type RiskBand = (typeof RISK_BANDS)[number];

export function classifyRiskBand(rawScore: string): RiskBand {
  const score = new Decimal(boundedScoreSchema.parse(rawScore));
  const band = RISK_BANDS.find((candidate) => score.lte(candidate.maximum));
  if (band === undefined) {
    throw new RiskEngineError("SCORE_OUT_OF_RANGE", "Risk score is outside 0 to 100");
  }
  return band;
}

export type RiskEngineErrorCode =
  "DUPLICATE_FACTOR" | "IMMUTABLE_METHODOLOGY" | "METHODOLOGY_NOT_PUBLISHED" | "SCORE_OUT_OF_RANGE";

export class RiskEngineError extends Error {
  public readonly code: RiskEngineErrorCode;

  public constructor(code: RiskEngineErrorCode, message: string) {
    super(message);
    this.name = "RiskEngineError";
    this.code = code;
  }
}

export interface CompositeRiskInput {
  category: ProductCategory;
  factors: RiskFactorResult[];
  calculatedAt: string;
  methodology?: RiskMethodology;
}

export type CompositeFactorResult = RiskFactorResult & {
  weightPct: string;
  effectiveScore: string | null;
  usedUnknownProxy: boolean;
};

export interface CompositeRiskResult {
  status: "VERIFIED" | "PROVISIONAL";
  category: ProductCategory;
  score: string;
  unroundedScore: string;
  band: RiskBand;
  evidenceCoveragePct: string;
  factors: CompositeFactorResult[];
  unavailableFactors: RiskFactor[];
  methodologyId: string;
  methodologyVersion: string;
  calculatedAt: string;
}

function unavailableFactor(
  factor: RiskFactor,
  calculatedAt: string,
  methodologyVersion: string,
  explanation: string
): RiskFactorResult {
  return {
    factor,
    status: "UNAVAILABLE",
    score: null,
    explanation,
    inputMetrics: [],
    sourceObservationIds: [],
    confidence: "UNAVAILABLE",
    evidenceCoveragePct: "0",
    calculatedAt,
    methodologyVersion
  };
}

function notApplicableFactor(
  factor: RiskFactor,
  existing: RiskFactorResult | undefined,
  calculatedAt: string,
  methodologyVersion: string
): RiskFactorResult {
  return {
    factor,
    status: "NOT_APPLICABLE",
    score: null,
    explanation:
      existing?.explanation ?? "The published category baseline assigns this factor zero weight.",
    inputMetrics: existing?.inputMetrics ?? [],
    sourceObservationIds: existing?.sourceObservationIds ?? [],
    confidence: existing?.confidence ?? "UNAVAILABLE",
    evidenceCoveragePct: existing?.evidenceCoveragePct ?? "0",
    calculatedAt: existing?.calculatedAt ?? calculatedAt,
    methodologyVersion
  };
}

export function calculateCompositeRisk(rawInput: CompositeRiskInput): CompositeRiskResult {
  const category = productCategorySchema.parse(rawInput.category);
  const calculatedAt = utcTimestampSchema.parse(rawInput.calculatedAt);
  const methodology = riskMethodologySchema.parse(rawInput.methodology ?? RISK_METHODOLOGY_V1);
  if (methodology.status !== "PUBLISHED") {
    throw new RiskEngineError(
      "METHODOLOGY_NOT_PUBLISHED",
      "Only an immutable published methodology may calculate a production composite"
    );
  }

  const parsedFactors = rawInput.factors.map((factor) => riskFactorResultSchema.parse(factor));
  const factorsById = new Map<RiskFactor, RiskFactorResult>();
  for (const factor of parsedFactors) {
    if (factorsById.has(factor.factor)) {
      throw new RiskEngineError(
        "DUPLICATE_FACTOR",
        `Factor ${factor.factor} was supplied more than once`
      );
    }
    factorsById.set(factor.factor, factor);
  }

  const weights = methodology.categoryWeights[category];
  let weightedScore = new Decimal(0);
  let weightedCoverage = new Decimal(0);
  const unavailableFactors: RiskFactor[] = [];
  const factorResults: CompositeFactorResult[] = [];

  for (const factorId of RISK_FACTORS) {
    const weight = new Decimal(weights[factorId]);
    const supplied = factorsById.get(factorId);
    if (weight.isZero()) {
      factorResults.push({
        ...notApplicableFactor(factorId, supplied, calculatedAt, methodology.semanticVersion),
        weightPct: "0",
        effectiveScore: null,
        usedUnknownProxy: false
      });
      continue;
    }

    const factor =
      supplied ??
      unavailableFactor(
        factorId,
        calculatedAt,
        methodology.semanticVersion,
        "No applicable evidence was supplied for this positively weighted factor."
      );
    const meetsCoverage = new Decimal(factor.evidenceCoveragePct).gte(
      methodology.minimumEvidenceCoveragePct
    );
    const available = factor.status === "AVAILABLE" && meetsCoverage;
    const effectiveScore = available
      ? new Decimal(factor.score)
      : new Decimal(methodology.unknownRiskProxy);
    const displayedFactor = available
      ? factor
      : unavailableFactor(
          factorId,
          factor.calculatedAt,
          methodology.semanticVersion,
          factor.status === "AVAILABLE"
            ? `Evidence coverage is below the ${methodology.minimumEvidenceCoveragePct}% methodology minimum.`
            : factor.explanation
        );

    if (!available) {
      unavailableFactors.push(factorId);
    }
    weightedScore = weightedScore.plus(weight.mul(effectiveScore));
    weightedCoverage = weightedCoverage.plus(
      weight.mul(available ? displayedFactor.evidenceCoveragePct : "0")
    );
    factorResults.push({
      ...displayedFactor,
      weightPct: decimalText(weight),
      effectiveScore: decimalText(effectiveScore),
      usedUnknownProxy: !available
    });
  }

  const unroundedScore = Decimal.max(0, Decimal.min(100, weightedScore.div(100)));
  const score = unroundedScore.toDecimalPlaces(2).toFixed(2);
  return {
    status: unavailableFactors.length === 0 ? "VERIFIED" : "PROVISIONAL",
    category,
    score,
    unroundedScore: decimalText(unroundedScore),
    band: classifyRiskBand(decimalText(unroundedScore)),
    evidenceCoveragePct: weightedCoverage.div(100).toDecimalPlaces(2).toFixed(2),
    factors: factorResults,
    unavailableFactors,
    methodologyId: methodology.id,
    methodologyVersion: methodology.semanticVersion,
    calculatedAt
  };
}

export const PENALTY_GROUP_FACTORS = {
  liquidityPenalty: ["LIQUIDITY"],
  redemptionPenalty: ["REDEMPTION", "LEGAL_AND_ELIGIBILITY_UNCERTAINTY"],
  issuerPenalty: ["ISSUER_OR_COUNTERPARTY", "OPERATIONAL"],
  custodyPenalty: ["CUSTODY"],
  smartContractPenalty: ["SMART_CONTRACT", "ORACLE", "CHAIN", "GOVERNANCE_AND_UPGRADEABILITY"],
  concentrationPenalty: ["CONCENTRATION"],
  yieldInstabilityPenalty: ["YIELD_INSTABILITY"],
  incentiveDependencyPenalty: ["INCENTIVE_DEPENDENCY"],
  marketOrDepegPenalty: ["MARKET_PRICE", "STABLECOIN_OR_DEPEG"],
  dataQualityPenalty: ["DATA_QUALITY"]
} as const satisfies Record<string, readonly RiskFactor[]>;

export type PenaltyGroupName = keyof typeof PENALTY_GROUP_FACTORS;

export interface PenaltyComponent {
  status: "APPLICABLE" | "NOT_APPLICABLE";
  factors: readonly RiskFactor[];
  groupSeverity: string | null;
  groupWeightSharePct: string;
  penaltyPp: string;
}

export type PenaltyComponents = Record<PenaltyGroupName, PenaltyComponent>;

export interface RiskAdjustedApyInput {
  netApy: string | MetricValue | null;
  compositeRisk: CompositeRiskResult;
  methodology?: RiskMethodology;
}

export type RiskAdjustedApyResult =
  | {
      status: "AVAILABLE" | "PROVISIONAL";
      label: "Comparative risk-adjusted APY";
      netApy: string;
      comparativeRiskAdjustedApy: string;
      totalPenaltyPp: string;
      penalties: PenaltyComponents;
      methodologyVersion: string;
    }
  | {
      status: "UNAVAILABLE";
      label: "Comparative risk-adjusted APY";
      netApy: null;
      comparativeRiskAdjustedApy: null;
      totalPenaltyPp: null;
      penalties: null;
      methodologyVersion: string;
      reason: "NET_APY_UNAVAILABLE";
    };

function extractNetApy(netApy: string | MetricValue | null): {
  value: string | null;
  provisional: boolean;
} {
  if (netApy === null) {
    return { value: null, provisional: false };
  }
  if (typeof netApy === "string") {
    return { value: decimalStringSchema.parse(netApy), provisional: false };
  }
  const parsed = metricValueSchema.parse(netApy);
  if (!metricHasValue(parsed)) {
    return { value: null, provisional: false };
  }
  return { value: parsed.value, provisional: parsed.status !== "CURRENT" };
}

export function calculateRiskAdjustedApy(rawInput: RiskAdjustedApyInput): RiskAdjustedApyResult {
  const methodology = riskMethodologySchema.parse(rawInput.methodology ?? RISK_METHODOLOGY_V1);
  if (methodology.status !== "PUBLISHED") {
    throw new RiskEngineError(
      "METHODOLOGY_NOT_PUBLISHED",
      "Penalty calculations require a published methodology"
    );
  }
  if (rawInput.compositeRisk.methodologyVersion !== methodology.semanticVersion) {
    throw new RiskEngineError(
      "METHODOLOGY_NOT_PUBLISHED",
      "Composite and penalty methodology versions must match for deterministic replay"
    );
  }

  const netApy = extractNetApy(rawInput.netApy);
  if (netApy.value === null) {
    return {
      status: "UNAVAILABLE",
      label: "Comparative risk-adjusted APY",
      netApy: null,
      comparativeRiskAdjustedApy: null,
      totalPenaltyPp: null,
      penalties: null,
      methodologyVersion: methodology.semanticVersion,
      reason: "NET_APY_UNAVAILABLE"
    };
  }

  const factors = new Map(rawInput.compositeRisk.factors.map((factor) => [factor.factor, factor]));
  const calculatePenalty = (name: PenaltyGroupName): PenaltyComponent => {
    const groupFactors = PENALTY_GROUP_FACTORS[name];
    let weightedSeverity = new Decimal(0);
    let groupWeight = new Decimal(0);
    for (const factorId of groupFactors) {
      const factor = factors.get(factorId);
      if (factor === undefined || factor.effectiveScore === null) {
        continue;
      }
      const weight = new Decimal(factor.weightPct);
      groupWeight = groupWeight.plus(weight);
      weightedSeverity = weightedSeverity.plus(weight.mul(factor.effectiveScore));
    }

    if (groupWeight.isZero()) {
      return {
        status: "NOT_APPLICABLE",
        factors: groupFactors,
        groupSeverity: null,
        groupWeightSharePct: "0",
        penaltyPp: "0"
      };
    }

    const severity = weightedSeverity.div(groupWeight);
    const penalty = new Decimal(methodology.maxAnnualPenaltyPp)
      .mul(groupWeight.div(100))
      .mul(severity.div(100).pow(2));
    return {
      status: "APPLICABLE",
      factors: groupFactors,
      groupSeverity: decimalText(severity),
      groupWeightSharePct: decimalText(groupWeight),
      penaltyPp: decimalText(penalty)
    };
  };

  const penalties: PenaltyComponents = {
    liquidityPenalty: calculatePenalty("liquidityPenalty"),
    redemptionPenalty: calculatePenalty("redemptionPenalty"),
    issuerPenalty: calculatePenalty("issuerPenalty"),
    custodyPenalty: calculatePenalty("custodyPenalty"),
    smartContractPenalty: calculatePenalty("smartContractPenalty"),
    concentrationPenalty: calculatePenalty("concentrationPenalty"),
    yieldInstabilityPenalty: calculatePenalty("yieldInstabilityPenalty"),
    incentiveDependencyPenalty: calculatePenalty("incentiveDependencyPenalty"),
    marketOrDepegPenalty: calculatePenalty("marketOrDepegPenalty"),
    dataQualityPenalty: calculatePenalty("dataQualityPenalty")
  };
  const totalPenalty = Object.values(penalties).reduce(
    (sum, penalty) => sum.plus(penalty.penaltyPp),
    new Decimal(0)
  );
  const adjusted = new Decimal(netApy.value).minus(totalPenalty);
  return {
    status:
      netApy.provisional || rawInput.compositeRisk.status === "PROVISIONAL"
        ? "PROVISIONAL"
        : "AVAILABLE",
    label: "Comparative risk-adjusted APY",
    netApy: netApy.value,
    comparativeRiskAdjustedApy: decimalText(adjusted),
    totalPenaltyPp: decimalText(totalPenalty),
    penalties,
    methodologyVersion: methodology.semanticVersion
  };
}

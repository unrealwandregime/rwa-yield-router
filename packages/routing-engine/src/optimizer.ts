import { annualizeTransactionCostRate, deterministicHash } from "@rwa-yield-router/yield-engine";
import Decimal from "decimal.js";
import highsLoader from "highs";

import {
  CONFIDENCE_RANK,
  confidenceMeetsMinimum,
  expandProfileConstraints,
  optimizationRequestSchema,
  type CanonicalConstraints,
  type CanonicalOptimizationRequest,
  type OptimizationRequest,
  type RouteCandidate,
  type SimulationInput
} from "./schemas.js";

export const ROUTING_SOLVER_VERSION = "highs-js-1.14.2";
export const ALLOCATION_TOLERANCE_PCT = "0.000001";
export const ANALYTICAL_SIMULATION_DISCLOSURE =
  "Analytical portfolio simulation based on current and historical data. It is not individualized investment advice and does not guarantee returns.";

export const EXCLUSION_REASON_CODES = [
  "LIFECYCLE_NOT_PUBLISHED",
  "DATA_STALE",
  "DATA_UNAVAILABLE",
  "ROUTE_UNVERIFIED",
  "JURISDICTION_INELIGIBLE",
  "INVESTOR_CLASS_INELIGIBLE",
  "ELIGIBILITY_UNKNOWN",
  "ELIGIBILITY_CONDITIONAL",
  "KYC_NOT_ACCEPTED",
  "KYC_UNKNOWN",
  "CONFIDENCE_BELOW_MINIMUM",
  "SCALE_BELOW_MINIMUM",
  "LIQUIDITY_BELOW_MINIMUM",
  "INCENTIVE_NOT_ACCEPTED",
  "PRODUCT_EXCLUDED",
  "PROTOCOL_EXCLUDED",
  "ISSUER_EXCLUDED",
  "CHAIN_EXCLUDED",
  "METHODOLOGY_VERSION_MISMATCH",
  "DATA_TIMESTAMP_IN_FUTURE"
] as const;

export type ExclusionReasonCode = (typeof EXCLUSION_REASON_CODES)[number];

export interface ExcludedCandidate {
  routeId: string;
  productId: string;
  reasonCodes: ExclusionReasonCode[];
  facts: Record<string, string>;
}

export const CONSTRAINT_CODES = [
  "PRODUCT_CAP",
  "ISSUER_CAP",
  "PROTOCOL_CAP",
  "CHAIN_CAP",
  "CATEGORY_CAP",
  "STABLECOIN_CAP",
  "DEFI_CAP",
  "RWA_CAP",
  "GOLD_CAP",
  "IMMEDIATE_LIQUIDITY_MINIMUM",
  "TWENTY_FOUR_HOUR_LIQUIDITY_MINIMUM",
  "SEVEN_DAY_LIQUIDITY_MINIMUM",
  "WEIGHTED_RISK_MAXIMUM",
  "ROUTE_LIQUIDITY_CAPACITY"
] as const;

export type ConstraintCode = (typeof CONSTRAINT_CODES)[number];

interface SelectedCostModel {
  fixedCostUsd: string;
  slippageBps: string;
  scenario: "DEFAULT" | "ASSET" | "CHAIN" | "ASSET_AND_CHAIN";
}

interface PreparedCandidate extends RouteCandidate {
  adjustedNetApy: string;
  adjustedComparativeRiskApy: string;
  annualizedTransactionCostApy: string;
  estimatedTransactionCostUsd: string;
  selectedCostModel: SelectedCostModel;
}

interface LinearConstraint {
  id: string;
  code: ConstraintCode;
  label: string;
  sense: "<=" | ">=";
  rhs: Decimal;
  coefficients: Decimal[];
}

export interface AllocationViolation {
  constraintId: string;
  code: ConstraintCode | "ALLOCATION_TOTAL" | "NEGATIVE_ALLOCATION";
  actual: string;
  limit: string;
}

export interface ConstraintDiagnostic {
  constraintId: string;
  code: ConstraintCode | ExclusionReasonCode | "NO_ELIGIBLE_CANDIDATE" | "NUMERICAL_INFEASIBILITY";
  label: string;
  currentValue: string;
  suggestedValue: string | null;
  relaxationPct: string | null;
}

export interface PortfolioAllocation {
  routeId: string;
  productId: string;
  allocationPct: string;
  grossApy: string;
  netApy: string;
  comparativeRiskAdjustedApy: string;
  riskScore: string;
  annualizedTransactionCostApy: string;
  estimatedTransactionCostUsd: string;
  rationaleCodes: string[];
  sourceObservationIds: string[];
}

export interface PortfolioMetrics {
  grossBlendedApy: string;
  netBlendedApy: string;
  comparativeRiskAdjustedApy: string;
  weightedRiskScore: string;
  liquidity: {
    immediatePct: string;
    within24HoursPct: string;
    within7DaysPct: string;
  };
  exposure: {
    rwaPct: string;
    defiPct: string;
    goldPct: string;
    stablecoinPct: string;
    byIssuer: Record<string, string>;
    byProtocol: Record<string, string>;
    byChain: Record<string, string>;
    byCategory: Record<string, string>;
  };
  yieldSourceBreakdown: Record<string, string>;
  incentiveDependentAllocationPct: string;
  dataConfidenceScore: string;
  estimatedTransactionCostsUsd: string;
}

interface ResultProvenance {
  inputHash: string;
  candidateSnapshotHash: string;
  resultHash: string;
  dataTimestamp: string;
  calculationVersion: string;
  methodologyVersion: string;
  solverVersion: string;
}

export interface FeasiblePortfolioResult extends ResultProvenance {
  status: "FEASIBLE";
  constraints: CanonicalConstraints;
  allocations: PortfolioAllocation[];
  metrics: PortfolioMetrics;
  excludedCandidates: ExcludedCandidate[];
  disclosure: typeof ANALYTICAL_SIMULATION_DISCLOSURE;
}

export interface InfeasiblePortfolioResult extends ResultProvenance {
  status: "INFEASIBLE";
  constraints: CanonicalConstraints;
  allocations: [];
  diagnostics: {
    summary: "No feasible allocation satisfies all constraints.";
    conflicts: ConstraintDiagnostic[];
    exclusionCounts: Partial<Record<ExclusionReasonCode, number>>;
  };
  excludedCandidates: ExcludedCandidate[];
  disclosure: typeof ANALYTICAL_SIMULATION_DISCLOSURE;
}

export interface UnavailablePortfolioResult extends ResultProvenance {
  status: "UNAVAILABLE";
  constraints: CanonicalConstraints;
  allocations: [];
  reason: "SOLVER_UNAVAILABLE" | "SOLVER_OUTPUT_INVALID";
  diagnostics: AllocationViolation[];
  excludedCandidates: ExcludedCandidate[];
  disclosure: typeof ANALYTICAL_SIMULATION_DISCLOSURE;
}

export type PortfolioOptimizationResult =
  FeasiblePortfolioResult | InfeasiblePortfolioResult | UnavailablePortfolioResult;

let highsPromise: ReturnType<typeof highsLoader> | undefined;

function decimalText(value: Decimal): string {
  if (value.isZero()) {
    return "0";
  }
  return value.toFixed(value.decimalPlaces());
}

function canonicalInput(input: SimulationInput, constraints: CanonicalConstraints): unknown {
  return {
    ...input,
    preferredChains: [...input.preferredChains].sort(),
    excludedChains: [...input.excludedChains].sort(),
    preferredAssets: [...input.preferredAssets].sort(),
    excludedProductIds: [...input.excludedProductIds].sort(),
    excludedProtocolIds: [...input.excludedProtocolIds].sort(),
    excludedIssuerIds: [...input.excludedIssuerIds].sort(),
    constraintOverrides: constraints
  };
}

function resultProvenance(
  input: SimulationInput,
  constraints: CanonicalConstraints,
  candidates: RouteCandidate[],
  resultWithoutHash: unknown
): ResultProvenance {
  const inputHash = deterministicHash(canonicalInput(input, constraints));
  const candidateSnapshotHash = deterministicHash(
    [...candidates].sort((left, right) => left.routeId.localeCompare(right.routeId))
  );
  const dataTimestamp =
    candidates
      .map((candidate) => candidate.dataTimestamp)
      .sort()
      .at(-1) ?? input.asOf;
  return {
    inputHash,
    candidateSnapshotHash,
    resultHash: deterministicHash({ inputHash, candidateSnapshotHash, result: resultWithoutHash }),
    dataTimestamp,
    calculationVersion: input.calculationVersion,
    methodologyVersion: input.methodologyVersion,
    solverVersion: ROUTING_SOLVER_VERSION
  };
}

function selectCostModel(candidate: RouteCandidate, input: SimulationInput): SelectedCostModel {
  const matches = candidate.transactionCosts.overrides
    .filter(
      (override) =>
        (override.originAssetId === null || override.originAssetId === input.currentAssetId) &&
        (override.originChainId === null || override.originChainId === input.currentChainId)
    )
    .map((override) => ({
      override,
      specificity:
        Number(override.originAssetId !== null) + Number(override.originChainId !== null),
      key: `${override.originAssetId ?? "*"}|${override.originChainId ?? "*"}`
    }))
    .sort(
      (left, right) => right.specificity - left.specificity || left.key.localeCompare(right.key)
    );
  const selected = matches[0]?.override;
  if (selected === undefined) {
    return {
      fixedCostUsd: candidate.transactionCosts.defaultFixedCostUsd,
      slippageBps: candidate.transactionCosts.defaultSlippageBps,
      scenario: "DEFAULT"
    };
  }
  return {
    fixedCostUsd: selected.fixedCostUsd,
    slippageBps: selected.slippageBps,
    scenario:
      selected.originAssetId !== null && selected.originChainId !== null
        ? "ASSET_AND_CHAIN"
        : selected.originAssetId !== null
          ? "ASSET"
          : "CHAIN"
  };
}

function prepareCandidate(candidate: RouteCandidate, input: SimulationInput): PreparedCandidate {
  const selectedCostModel = selectCostModel(candidate, input);
  const slippageUsd = new Decimal(input.capitalUsd).mul(selectedCostModel.slippageBps).div(10_000);
  const totalCostUsd = new Decimal(selectedCostModel.fixedCostUsd).plus(slippageUsd);
  const yearFraction = new Decimal(input.holdingPeriodDays).div(365);
  const annualizedCost = annualizeTransactionCostRate(
    decimalText(totalCostUsd),
    input.capitalUsd,
    yearFraction
  );
  return {
    ...candidate,
    adjustedNetApy: decimalText(
      new Decimal(candidate.netApyBeforeTransactionCosts).minus(annualizedCost)
    ),
    adjustedComparativeRiskApy: decimalText(
      new Decimal(candidate.comparativeRiskAdjustedApyBeforeTransactionCosts).minus(annualizedCost)
    ),
    annualizedTransactionCostApy: decimalText(annualizedCost),
    estimatedTransactionCostUsd: decimalText(totalCostUsd),
    selectedCostModel
  };
}

function evaluateCandidate(
  candidate: RouteCandidate,
  input: SimulationInput
): ExcludedCandidate | null {
  const reasons = new Set<ExclusionReasonCode>();
  const facts: Record<string, string> = {
    lifecycle: candidate.lifecycle,
    dataStatus: candidate.dataStatus,
    confidence: candidate.confidence,
    verified: String(candidate.verified),
    eligibility: candidate.eligibility.status,
    kyc: candidate.kyc,
    aumOrTvlUsd: candidate.aumOrTvlUsd,
    availableLiquidityUsd: candidate.availableLiquidityUsd
  };

  if (candidate.lifecycle !== "PUBLISHED") {
    reasons.add("LIFECYCLE_NOT_PUBLISHED");
  }
  if (candidate.dataStatus === "STALE") {
    reasons.add("DATA_STALE");
  } else if (
    candidate.dataStatus === "UNKNOWN" ||
    candidate.dataStatus === "UNAVAILABLE" ||
    candidate.dataStatus === "AWAITING_VERIFICATION"
  ) {
    reasons.add("DATA_UNAVAILABLE");
  }
  if (!candidate.verified) {
    reasons.add("ROUTE_UNVERIFIED");
  }
  if (
    candidate.eligibility.status === "UNKNOWN" ||
    candidate.eligibility.status === "AWAITING_VERIFICATION"
  ) {
    if (!input.advancedResearchMode || !input.kycAcceptable) reasons.add("ELIGIBILITY_UNKNOWN");
  } else if (candidate.eligibility.status === "CONDITIONAL") {
    if (!input.advancedResearchMode || !input.kycAcceptable) reasons.add("ELIGIBILITY_CONDITIONAL");
  } else if (candidate.eligibility.status === "INELIGIBLE") {
    reasons.add("JURISDICTION_INELIGIBLE");
  }
  if (
    candidate.eligibility.status === "ELIGIBLE" &&
    !candidate.eligibility.jurisdictions.includes("*") &&
    !candidate.eligibility.jurisdictions.includes(input.jurisdiction)
  ) {
    reasons.add("JURISDICTION_INELIGIBLE");
  }
  if (
    candidate.eligibility.status === "ELIGIBLE" &&
    !candidate.eligibility.investorClassifications.includes(input.investorClassification)
  ) {
    reasons.add("INVESTOR_CLASS_INELIGIBLE");
  }
  if (candidate.kyc === "REQUIRED" && !input.kycAcceptable) {
    reasons.add("KYC_NOT_ACCEPTED");
  } else if (candidate.kyc === "UNKNOWN") {
    if (!input.advancedResearchMode || !input.kycAcceptable) reasons.add("KYC_UNKNOWN");
  }
  if (!confidenceMeetsMinimum(candidate.confidence, input.minimumDataConfidence)) {
    reasons.add("CONFIDENCE_BELOW_MINIMUM");
  }
  if (new Decimal(candidate.aumOrTvlUsd).lt(input.minimumAumOrTvlUsd)) {
    reasons.add("SCALE_BELOW_MINIMUM");
  }
  if (new Decimal(candidate.availableLiquidityUsd).lt(input.minimumAvailableLiquidityUsd)) {
    reasons.add("LIQUIDITY_BELOW_MINIMUM");
  }
  if (!input.incentiveYieldAcceptable && !new Decimal(candidate.incentiveApy).isZero()) {
    reasons.add("INCENTIVE_NOT_ACCEPTED");
  }
  if (input.excludedProductIds.includes(candidate.productId)) {
    reasons.add("PRODUCT_EXCLUDED");
  }
  if (candidate.protocolId !== null && input.excludedProtocolIds.includes(candidate.protocolId)) {
    reasons.add("PROTOCOL_EXCLUDED");
  }
  if (input.excludedIssuerIds.includes(candidate.issuerId)) {
    reasons.add("ISSUER_EXCLUDED");
  }
  if (input.excludedChains.includes(candidate.chainId)) {
    reasons.add("CHAIN_EXCLUDED");
  }
  if (candidate.methodologyVersion !== input.methodologyVersion) {
    reasons.add("METHODOLOGY_VERSION_MISMATCH");
  }
  if (Date.parse(candidate.dataTimestamp) > Date.parse(input.asOf)) {
    reasons.add("DATA_TIMESTAMP_IN_FUTURE");
  }

  if (reasons.size === 0) {
    return null;
  }
  return {
    routeId: candidate.routeId,
    productId: candidate.productId,
    reasonCodes: [...reasons].sort(
      (left, right) => EXCLUSION_REASON_CODES.indexOf(left) - EXCLUSION_REASON_CODES.indexOf(right)
    ),
    facts
  };
}

function coefficients(length: number, indices: number[], value = new Decimal(1)): Decimal[] {
  const result = Array.from({ length }, () => new Decimal(0));
  for (const index of indices) {
    result[index] = value;
  }
  return result;
}

function groupIndices(
  candidates: PreparedCandidate[],
  select: (candidate: PreparedCandidate) => string | null
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const key = select(candidate);
    if (key === null) {
      return;
    }
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function buildConstraints(
  candidates: PreparedCandidate[],
  constraints: CanonicalConstraints,
  capitalUsd: string
): LinearConstraint[] {
  const result: LinearConstraint[] = [];
  let nextId = 0;
  const add = (
    code: ConstraintCode,
    label: string,
    sense: "<=" | ">=",
    rhs: string | Decimal,
    values: Decimal[]
  ): void => {
    result.push({
      id: `c_${String(nextId).padStart(4, "0")}`,
      code,
      label,
      sense,
      rhs: new Decimal(rhs),
      coefficients: values
    });
    nextId += 1;
  };

  const addGroupCaps = (
    groups: Map<string, number[]>,
    code: ConstraintCode,
    cap: string,
    labelPrefix: string
  ): void => {
    for (const [name, indices] of groups) {
      add(code, `${labelPrefix} ${name}`, "<=", cap, coefficients(candidates.length, indices));
    }
  };

  candidates.forEach((candidate, index) => {
    const capacity = Decimal.min(
      100,
      new Decimal(candidate.availableLiquidityUsd).div(capitalUsd).mul(100)
    );
    add(
      "ROUTE_LIQUIDITY_CAPACITY",
      `Available liquidity for route ${candidate.routeId}`,
      "<=",
      capacity,
      coefficients(candidates.length, [index])
    );
  });

  addGroupCaps(
    groupIndices(candidates, (candidate) => candidate.productId),
    "PRODUCT_CAP",
    constraints.maxProductAllocationPct,
    "Product"
  );
  addGroupCaps(
    groupIndices(candidates, (candidate) => candidate.issuerId),
    "ISSUER_CAP",
    constraints.maxIssuerExposurePct,
    "Issuer"
  );
  addGroupCaps(
    groupIndices(candidates, (candidate) => candidate.protocolId),
    "PROTOCOL_CAP",
    constraints.maxProtocolExposurePct,
    "Protocol"
  );
  addGroupCaps(
    groupIndices(candidates, (candidate) => candidate.chainId),
    "CHAIN_CAP",
    constraints.maxChainExposurePct,
    "Chain"
  );
  addGroupCaps(
    groupIndices(candidates, (candidate) => candidate.category),
    "CATEGORY_CAP",
    constraints.maxCategoryAllocationPct,
    "Category"
  );

  const stablecoinIndices = candidates.flatMap((candidate, index) =>
    candidate.stablecoinId === null ? [] : [index]
  );
  const defiIndices = candidates.flatMap((candidate, index) => (candidate.isDefi ? [index] : []));
  const rwaIndices = candidates.flatMap((candidate, index) => (candidate.isRwa ? [index] : []));
  const goldIndices = candidates.flatMap((candidate, index) => (candidate.isGold ? [index] : []));
  if (stablecoinIndices.length > 0) {
    add(
      "STABLECOIN_CAP",
      "Total stablecoin exposure",
      "<=",
      constraints.maxStablecoinExposurePct,
      coefficients(candidates.length, stablecoinIndices)
    );
  }
  if (defiIndices.length > 0) {
    add(
      "DEFI_CAP",
      "Total DeFi exposure",
      "<=",
      constraints.maxDefiExposurePct,
      coefficients(candidates.length, defiIndices)
    );
  }
  if (rwaIndices.length > 0) {
    add(
      "RWA_CAP",
      "Total RWA exposure",
      "<=",
      constraints.maxRwaExposurePct,
      coefficients(candidates.length, rwaIndices)
    );
  }
  if (goldIndices.length > 0) {
    add(
      "GOLD_CAP",
      "Total gold exposure",
      "<=",
      constraints.maxGoldExposurePct,
      coefficients(candidates.length, goldIndices)
    );
  }

  add(
    "IMMEDIATE_LIQUIDITY_MINIMUM",
    "Portfolio liquidity available immediately",
    ">=",
    constraints.minImmediateLiquidityPct,
    candidates.map((candidate) => new Decimal(candidate.liquidity.immediatePct).div(100))
  );
  add(
    "TWENTY_FOUR_HOUR_LIQUIDITY_MINIMUM",
    "Portfolio liquidity available within 24 hours",
    ">=",
    constraints.min24HourLiquidityPct,
    candidates.map((candidate) => new Decimal(candidate.liquidity.within24HoursPct).div(100))
  );
  add(
    "SEVEN_DAY_LIQUIDITY_MINIMUM",
    "Portfolio liquidity available within seven days",
    ">=",
    constraints.min7DayLiquidityPct,
    candidates.map((candidate) => new Decimal(candidate.liquidity.within7DaysPct).div(100))
  );
  add(
    "WEIGHTED_RISK_MAXIMUM",
    "Weighted comparative risk score",
    "<=",
    constraints.maxWeightedRiskScore,
    candidates.map((candidate) => new Decimal(candidate.riskScore).div(100))
  );
  return result;
}

function expression(values: Decimal[], names: string[]): string {
  const terms: string[] = [];
  values.forEach((value, index) => {
    if (value.isZero()) {
      return;
    }
    const name = names[index];
    if (name === undefined) {
      return;
    }
    const sign = value.isNegative() ? "-" : "+";
    terms.push(`${sign} ${decimalText(value.abs())} ${name}`);
  });
  return terms.length === 0 ? "0" : terms.join(" ");
}

function buildLpModel(
  objective: Decimal[],
  constraints: LinearConstraint[],
  objectiveDirection: "Maximize" | "Minimize" = "Maximize",
  extraConstraints: string[] = []
): string {
  const variableNames = objective.map((_, index) => `x_${String(index).padStart(4, "0")}`);
  const lines = [
    objectiveDirection,
    ` objective: ${expression(objective, variableNames)}`,
    "Subject To",
    ` allocation_total: ${expression(
      variableNames.map(() => new Decimal(1)),
      variableNames
    )} = 100`
  ];
  constraints.forEach((constraint) => {
    lines.push(
      ` ${constraint.id}: ${expression(constraint.coefficients, variableNames)} ${constraint.sense} ${decimalText(constraint.rhs)}`
    );
  });
  lines.push(...extraConstraints);
  lines.push("Bounds");
  for (const name of variableNames) {
    lines.push(` 0 <= ${name} <= 100`);
  }
  lines.push("End");
  return lines.join("\n");
}

async function solveLp(
  model: string
): Promise<ReturnType<Awaited<ReturnType<typeof highsLoader>>["solve"]>> {
  highsPromise ??= highsLoader();
  const highs = await highsPromise;
  return highs.solve(model, {
    solver: "simplex",
    presolve: "on",
    parallel: "off",
    threads: 1,
    random_seed: 0,
    primal_feasibility_tolerance: 1e-9,
    dual_feasibility_tolerance: 1e-9,
    output_flag: false,
    log_to_console: false
  });
}

function allocationsFromSolution(
  solution: Awaited<ReturnType<typeof solveLp>>,
  candidateCount: number
): Decimal[] {
  return Array.from({ length: candidateCount }, (_, index) => {
    const name = `x_${String(index).padStart(4, "0")}`;
    const column = solution.Columns[name];
    const primal = column !== undefined && "Primal" in column ? column.Primal : undefined;
    if (primal === undefined || !Number.isFinite(primal)) {
      throw new Error(`Solver omitted a finite allocation for ${name}`);
    }
    return new Decimal(primal.toPrecision(17));
  });
}

function preferenceObjective(candidates: PreparedCandidate[], input: SimulationInput): Decimal[] {
  return candidates.map((candidate, index) => {
    const chainPreference = input.preferredChains.includes(candidate.chainId) ? 2 : 0;
    const assetPreference = input.preferredAssets.includes(candidate.underlyingAssetId) ? 1 : 0;
    const lexicalPreference = new Decimal(candidates.length - index).div(candidates.length + 1);
    return new Decimal(chainPreference + assetPreference).mul(1_000).plus(lexicalPreference);
  });
}

function quantizeAllocations(rawAllocations: Decimal[]): Decimal[] {
  const tolerance = new Decimal(ALLOCATION_TOLERANCE_PCT);
  const nonNegative = rawAllocations.map((allocation) =>
    allocation.isNegative() && allocation.abs().lte(tolerance) ? new Decimal(0) : allocation
  );
  const rawTotal = nonNegative.reduce((sum, allocation) => sum.plus(allocation), new Decimal(0));
  if (rawTotal.lte(0)) {
    return nonNegative;
  }
  const normalized = nonNegative.map((allocation) => allocation.mul(100).div(rawTotal));
  const scale = 10;
  const unit = new Decimal(1).div(new Decimal(10).pow(scale));
  const floors = normalized.map((allocation) =>
    allocation.toDecimalPlaces(scale, Decimal.ROUND_FLOOR)
  );
  const floorTotal = floors.reduce((sum, allocation) => sum.plus(allocation), new Decimal(0));
  const unitsToAllocate = new Decimal(100)
    .minus(floorTotal)
    .div(unit)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  const residualOrder = normalized
    .map((allocation, index) => ({
      index,
      residual: allocation.minus(floors[index] ?? 0)
    }))
    .sort((left, right) => right.residual.comparedTo(left.residual) || left.index - right.index);
  for (let index = 0; index < unitsToAllocate; index += 1) {
    const target = residualOrder[index % residualOrder.length]?.index;
    if (target !== undefined) {
      floors[target] = (floors[target] ?? new Decimal(0)).plus(unit);
    }
  }
  return floors;
}

export function revalidateAllocation(
  allocations: readonly Decimal[],
  constraints: readonly LinearConstraint[]
): AllocationViolation[] {
  const tolerance = new Decimal(ALLOCATION_TOLERANCE_PCT);
  const violations: AllocationViolation[] = [];
  const total = allocations.reduce((sum, allocation) => sum.plus(allocation), new Decimal(0));
  if (total.minus(100).abs().gt(tolerance)) {
    violations.push({
      constraintId: "allocation_total",
      code: "ALLOCATION_TOTAL",
      actual: decimalText(total),
      limit: "100"
    });
  }
  allocations.forEach((allocation, index) => {
    if (allocation.lt(tolerance.neg())) {
      violations.push({
        constraintId: `x_${String(index).padStart(4, "0")}`,
        code: "NEGATIVE_ALLOCATION",
        actual: decimalText(allocation),
        limit: "0"
      });
    }
  });
  for (const constraint of constraints) {
    const actual = constraint.coefficients.reduce(
      (sum, coefficient, index) => sum.plus(coefficient.mul(allocations[index] ?? 0)),
      new Decimal(0)
    );
    const violated =
      constraint.sense === "<="
        ? actual.minus(constraint.rhs).gt(tolerance)
        : constraint.rhs.minus(actual).gt(tolerance);
    if (violated) {
      violations.push({
        constraintId: constraint.id,
        code: constraint.code,
        actual: decimalText(actual),
        limit: decimalText(constraint.rhs)
      });
    }
  }
  return violations;
}

function exclusionCounts(
  exclusions: ExcludedCandidate[]
): Partial<Record<ExclusionReasonCode, number>> {
  const counts = new Map<ExclusionReasonCode, number>();
  for (const exclusion of exclusions) {
    for (const reason of exclusion.reasonCodes) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort(
      ([left], [right]) =>
        EXCLUSION_REASON_CODES.indexOf(left) - EXCLUSION_REASON_CODES.indexOf(right)
    )
  );
}

async function diagnoseInfeasibility(
  candidates: PreparedCandidate[],
  constraints: LinearConstraint[],
  exclusions: ExcludedCandidate[]
): Promise<ConstraintDiagnostic[]> {
  if (candidates.length === 0) {
    const counts = exclusionCounts(exclusions);
    const diagnostics = EXCLUSION_REASON_CODES.flatMap((code) => {
      const count = counts[code];
      return count === undefined
        ? []
        : [
            {
              constraintId: `exclusion_${code.toLowerCase()}`,
              code,
              label: `${count} candidate route(s) were excluded by ${code}.`,
              currentValue: String(count),
              suggestedValue: null,
              relaxationPct: null
            }
          ];
    });
    return diagnostics.length > 0
      ? diagnostics
      : [
          {
            constraintId: "no_candidates",
            code: "NO_ELIGIBLE_CANDIDATE",
            label: "No candidate routes were supplied.",
            currentValue: "0",
            suggestedValue: null,
            relaxationPct: null
          }
        ];
  }

  const variableNames = candidates.map((_, index) => `x_${String(index).padStart(4, "0")}`);
  const slackNames = constraints.map((_, index) => `s_${String(index).padStart(4, "0")}`);
  const lines = [
    "Minimize",
    ` objective: ${expression(
      slackNames.map(() => new Decimal(1)),
      slackNames
    )}`,
    "Subject To",
    ` allocation_total: ${expression(
      variableNames.map(() => new Decimal(1)),
      variableNames
    )} = 100`
  ];
  constraints.forEach((constraint, index) => {
    const slackName = slackNames[index];
    const slackSign = constraint.sense === "<=" ? "-" : "+";
    lines.push(
      ` ${constraint.id}: ${expression(constraint.coefficients, variableNames)} ${slackSign} 1 ${slackName} ${constraint.sense} ${decimalText(constraint.rhs)}`
    );
  });
  lines.push("Bounds");
  variableNames.forEach((name) => lines.push(` 0 <= ${name} <= 100`));
  slackNames.forEach((name) => lines.push(` 0 <= ${name} <= 100`));
  lines.push("End");
  const solution = await solveLp(lines.join("\n"));
  if (solution.Status !== "Optimal") {
    return [
      {
        constraintId: "numerical_infeasibility",
        code: "NUMERICAL_INFEASIBILITY",
        label: "The bounded relaxation model could not identify a safe feasible relaxation.",
        currentValue: solution.Status,
        suggestedValue: null,
        relaxationPct: null
      }
    ];
  }

  const tolerance = new Decimal(ALLOCATION_TOLERANCE_PCT);
  const diagnostics = constraints.flatMap((constraint, index) => {
    const slackName = slackNames[index];
    const primal = slackName === undefined ? undefined : solution.Columns[slackName]?.Primal;
    if (primal === undefined || !Number.isFinite(primal)) {
      return [];
    }
    const slack = new Decimal(primal.toPrecision(17));
    if (slack.lte(tolerance)) {
      return [];
    }
    const suggested =
      constraint.sense === "<="
        ? constraint.rhs.plus(slack)
        : Decimal.max(0, constraint.rhs.minus(slack));
    return [
      {
        constraintId: constraint.id,
        code: constraint.code,
        label: constraint.label,
        currentValue: decimalText(constraint.rhs),
        suggestedValue: decimalText(suggested),
        relaxationPct: decimalText(slack)
      }
    ];
  });
  return diagnostics.sort((left, right) => {
    const leftOrder = CONSTRAINT_CODES.findIndex((code) => code === left.code);
    const rightOrder = CONSTRAINT_CODES.findIndex((code) => code === right.code);
    return leftOrder - rightOrder || left.constraintId.localeCompare(right.constraintId);
  });
}

function aggregateBy(
  candidates: PreparedCandidate[],
  allocations: Decimal[],
  key: (candidate: PreparedCandidate) => string | null
): Record<string, string> {
  const values = new Map<string, Decimal>();
  candidates.forEach((candidate, index) => {
    const group = key(candidate);
    const allocation = allocations[index] ?? new Decimal(0);
    if (group !== null && allocation.gt(0)) {
      values.set(group, (values.get(group) ?? new Decimal(0)).plus(allocation));
    }
  });
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyName, value]) => [keyName, decimalText(value)])
  );
}

function weighted(
  candidates: PreparedCandidate[],
  allocations: Decimal[],
  value: (candidate: PreparedCandidate) => Decimal
): Decimal {
  return candidates.reduce(
    (sum, candidate, index) =>
      sum.plus(
        value(candidate)
          .mul(allocations[index] ?? 0)
          .div(100)
      ),
    new Decimal(0)
  );
}

function buildMetrics(candidates: PreparedCandidate[], allocations: Decimal[]): PortfolioMetrics {
  const yieldSources = new Map<string, Decimal>();
  candidates.forEach((candidate, index) => {
    const allocation = allocations[index] ?? new Decimal(0);
    candidate.yieldSourceBreakdown.forEach((source) => {
      const contribution = allocation.mul(source.sharePct).div(100);
      yieldSources.set(
        source.sourceClass,
        (yieldSources.get(source.sourceClass) ?? new Decimal(0)).plus(contribution)
      );
    });
  });

  const flagExposure = (select: (candidate: PreparedCandidate) => boolean): string =>
    decimalText(
      candidates.reduce(
        (sum, candidate, index) => (select(candidate) ? sum.plus(allocations[index] ?? 0) : sum),
        new Decimal(0)
      )
    );

  return {
    grossBlendedApy: decimalText(
      weighted(candidates, allocations, (candidate) => new Decimal(candidate.grossApy))
    ),
    netBlendedApy: decimalText(
      weighted(candidates, allocations, (candidate) => new Decimal(candidate.adjustedNetApy))
    ),
    comparativeRiskAdjustedApy: decimalText(
      weighted(
        candidates,
        allocations,
        (candidate) => new Decimal(candidate.adjustedComparativeRiskApy)
      )
    ),
    weightedRiskScore: decimalText(
      weighted(candidates, allocations, (candidate) => new Decimal(candidate.riskScore))
    ),
    liquidity: {
      immediatePct: decimalText(
        weighted(
          candidates,
          allocations,
          (candidate) => new Decimal(candidate.liquidity.immediatePct)
        )
      ),
      within24HoursPct: decimalText(
        weighted(
          candidates,
          allocations,
          (candidate) => new Decimal(candidate.liquidity.within24HoursPct)
        )
      ),
      within7DaysPct: decimalText(
        weighted(
          candidates,
          allocations,
          (candidate) => new Decimal(candidate.liquidity.within7DaysPct)
        )
      )
    },
    exposure: {
      rwaPct: flagExposure((candidate) => candidate.isRwa),
      defiPct: flagExposure((candidate) => candidate.isDefi),
      goldPct: flagExposure((candidate) => candidate.isGold),
      stablecoinPct: flagExposure((candidate) => candidate.stablecoinId !== null),
      byIssuer: aggregateBy(candidates, allocations, (candidate) => candidate.issuerId),
      byProtocol: aggregateBy(candidates, allocations, (candidate) => candidate.protocolId),
      byChain: aggregateBy(candidates, allocations, (candidate) => candidate.chainId),
      byCategory: aggregateBy(candidates, allocations, (candidate) => candidate.category)
    },
    yieldSourceBreakdown: Object.fromEntries(
      [...yieldSources.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, allocation]) => [source, decimalText(allocation)])
    ),
    incentiveDependentAllocationPct: flagExposure(
      (candidate) => !new Decimal(candidate.incentiveApy).isZero()
    ),
    dataConfidenceScore: decimalText(
      weighted(candidates, allocations, (candidate) =>
        new Decimal(CONFIDENCE_RANK[candidate.confidence]).div(8).mul(100)
      )
    ),
    estimatedTransactionCostsUsd: decimalText(
      weighted(
        candidates,
        allocations,
        (candidate) => new Decimal(candidate.estimatedTransactionCostUsd)
      )
    )
  };
}

function buildAllocations(
  candidates: PreparedCandidate[],
  allocations: Decimal[],
  input: SimulationInput
): PortfolioAllocation[] {
  return candidates.flatMap((candidate, index) => {
    const allocation = allocations[index] ?? new Decimal(0);
    if (allocation.isZero()) {
      return [];
    }
    const rationaleCodes = [
      "SELECTED_BY_DETERMINISTIC_OPTIMIZER",
      "TRANSACTION_COSTS_RECALCULATED",
      `COST_SCENARIO_${candidate.selectedCostModel.scenario}`
    ];
    if (input.preferredChains.includes(candidate.chainId)) {
      rationaleCodes.push("PREFERRED_CHAIN");
    }
    if (input.preferredAssets.includes(candidate.underlyingAssetId)) {
      rationaleCodes.push("PREFERRED_ASSET");
    }
    if (input.advancedResearchMode) {
      rationaleCodes.push("ADVANCED_RESEARCH_ASSUMPTIONS_APPLIED");
    }
    return [
      {
        routeId: candidate.routeId,
        productId: candidate.productId,
        allocationPct: decimalText(allocation),
        grossApy: candidate.grossApy,
        netApy: candidate.adjustedNetApy,
        comparativeRiskAdjustedApy: candidate.adjustedComparativeRiskApy,
        riskScore: candidate.riskScore,
        annualizedTransactionCostApy: candidate.annualizedTransactionCostApy,
        estimatedTransactionCostUsd: candidate.estimatedTransactionCostUsd,
        rationaleCodes,
        sourceObservationIds: [...candidate.sourceObservationIds].sort()
      }
    ];
  });
}

export async function optimizePortfolio(
  rawRequest: OptimizationRequest
): Promise<PortfolioOptimizationResult> {
  const request: CanonicalOptimizationRequest = optimizationRequestSchema.parse(rawRequest);
  const input = request.input;
  const constraints = expandProfileConstraints(input.profile, input.constraintOverrides);
  const sortedCandidates = [...request.candidates].sort((left, right) =>
    left.routeId.localeCompare(right.routeId)
  );
  const excludedCandidates = sortedCandidates
    .map((candidate) => evaluateCandidate(candidate, input))
    .filter((candidate): candidate is ExcludedCandidate => candidate !== null);
  const excludedRouteIds = new Set(excludedCandidates.map((candidate) => candidate.routeId));
  const candidates = sortedCandidates
    .filter((candidate) => !excludedRouteIds.has(candidate.routeId))
    .map((candidate) => prepareCandidate(candidate, input));
  const linearConstraints = buildConstraints(candidates, constraints, input.capitalUsd);

  const baseWithoutHash = {
    constraints,
    excludedCandidates,
    disclosure: ANALYTICAL_SIMULATION_DISCLOSURE
  };

  if (candidates.length === 0) {
    const conflicts = await diagnoseInfeasibility(
      candidates,
      linearConstraints,
      excludedCandidates
    );
    const withoutHash = {
      ...baseWithoutHash,
      status: "INFEASIBLE",
      allocations: [],
      diagnostics: {
        summary: "No feasible allocation satisfies all constraints.",
        conflicts,
        exclusionCounts: exclusionCounts(excludedCandidates)
      }
    };
    return {
      ...withoutHash,
      status: "INFEASIBLE",
      allocations: [],
      diagnostics: {
        ...withoutHash.diagnostics,
        summary: "No feasible allocation satisfies all constraints."
      },
      disclosure: ANALYTICAL_SIMULATION_DISCLOSURE,
      ...resultProvenance(input, constraints, sortedCandidates, withoutHash)
    };
  }

  const objective = candidates.map(
    (candidate) => new Decimal(candidate.adjustedComparativeRiskApy)
  );
  let primarySolution: Awaited<ReturnType<typeof solveLp>>;
  try {
    primarySolution = await solveLp(buildLpModel(objective, linearConstraints));
  } catch {
    const withoutHash = {
      ...baseWithoutHash,
      status: "UNAVAILABLE",
      allocations: [],
      reason: "SOLVER_UNAVAILABLE",
      diagnostics: []
    };
    return {
      ...withoutHash,
      status: "UNAVAILABLE",
      allocations: [],
      reason: "SOLVER_UNAVAILABLE",
      diagnostics: [],
      disclosure: ANALYTICAL_SIMULATION_DISCLOSURE,
      ...resultProvenance(input, constraints, sortedCandidates, withoutHash)
    };
  }

  if (primarySolution.Status !== "Optimal") {
    const conflicts = await diagnoseInfeasibility(
      candidates,
      linearConstraints,
      excludedCandidates
    );
    const withoutHash = {
      ...baseWithoutHash,
      status: "INFEASIBLE",
      allocations: [],
      diagnostics: {
        summary: "No feasible allocation satisfies all constraints.",
        conflicts,
        exclusionCounts: exclusionCounts(excludedCandidates)
      }
    };
    return {
      ...withoutHash,
      status: "INFEASIBLE",
      allocations: [],
      diagnostics: {
        ...withoutHash.diagnostics,
        summary: "No feasible allocation satisfies all constraints."
      },
      disclosure: ANALYTICAL_SIMULATION_DISCLOSURE,
      ...resultProvenance(input, constraints, sortedCandidates, withoutHash)
    };
  }

  let selectedSolution = primarySolution;
  const variableNames = objective.map((_, index) => `x_${String(index).padStart(4, "0")}`);
  const objectiveFloor = new Decimal(primarySolution.ObjectiveValue.toPrecision(17)).minus(
    "0.00000001"
  );
  const floorConstraint = ` objective_floor: ${expression(objective, variableNames)} >= ${decimalText(objectiveFloor)}`;
  try {
    const tieSolution = await solveLp(
      buildLpModel(preferenceObjective(candidates, input), linearConstraints, "Maximize", [
        floorConstraint
      ])
    );
    if (tieSolution.Status === "Optimal") {
      selectedSolution = tieSolution;
    }
  } catch {
    selectedSolution = primarySolution;
  }

  const allocations = quantizeAllocations(
    allocationsFromSolution(selectedSolution, candidates.length)
  );
  const violations = revalidateAllocation(allocations, linearConstraints);
  if (violations.length > 0) {
    const withoutHash = {
      ...baseWithoutHash,
      status: "UNAVAILABLE",
      allocations: [],
      reason: "SOLVER_OUTPUT_INVALID",
      diagnostics: violations
    };
    return {
      ...withoutHash,
      status: "UNAVAILABLE",
      allocations: [],
      reason: "SOLVER_OUTPUT_INVALID",
      disclosure: ANALYTICAL_SIMULATION_DISCLOSURE,
      ...resultProvenance(input, constraints, sortedCandidates, withoutHash)
    };
  }

  const portfolioAllocations = buildAllocations(candidates, allocations, input);
  const metrics = buildMetrics(candidates, allocations);
  const withoutHash = {
    ...baseWithoutHash,
    status: "FEASIBLE",
    allocations: portfolioAllocations,
    metrics
  };
  return {
    ...withoutHash,
    status: "FEASIBLE",
    disclosure: ANALYTICAL_SIMULATION_DISCLOSURE,
    ...resultProvenance(input, constraints, sortedCandidates, withoutHash)
  };
}

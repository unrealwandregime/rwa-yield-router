import Decimal from "decimal.js";
import type {
  ExcludedCandidate,
  PortfolioAllocation,
  RouteCandidate
} from "@rwa-yield-router/routing-engine";

interface CandidatePersistenceRow {
  canonicalFacts: {
    candidate: RouteCandidate;
    exclusionReasonCodes: ExcludedCandidate["reasonCodes"];
  };
  exclusionReasonCode: string | null;
  included: boolean;
  ordinal: number;
  routeId: string;
  simulationId: string;
}

interface AllocationPersistenceRow {
  allocatedAmount: string;
  allocationRatio: string;
  comparativeRiskAdjustedApy: string | null;
  grossApy: string;
  netApy: string | null;
  rationale: string;
  riskScore: string;
  routeId: string;
  simulationId: string;
}

function decimalText(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed(value.decimalPlaces());
}

function requireDatabaseRouteId(routeIdsBySlug: ReadonlyMap<string, string>, slug: string): string {
  const routeId = routeIdsBySlug.get(slug);
  if (routeId === undefined) {
    throw new Error(`Current canonical route is unavailable for ${slug}`);
  }
  return routeId;
}

export function buildCandidatePersistenceRows(
  simulationId: string,
  candidates: readonly RouteCandidate[],
  exclusions: readonly ExcludedCandidate[],
  routeIdsBySlug: ReadonlyMap<string, string>
): CandidatePersistenceRow[] {
  const candidateSlugs = new Set(candidates.map((candidate) => candidate.routeId));
  if (candidateSlugs.size !== candidates.length) {
    throw new Error("Simulation candidate route identifiers must be unique");
  }
  for (const exclusion of exclusions) {
    if (!candidateSlugs.has(exclusion.routeId)) {
      throw new Error(`Excluded route ${exclusion.routeId} was not in the candidate snapshot`);
    }
  }
  const exclusionsBySlug = new Map(exclusions.map((exclusion) => [exclusion.routeId, exclusion]));
  return [...candidates]
    .sort((left, right) => left.routeId.localeCompare(right.routeId))
    .map((candidate, index) => {
      const exclusion = exclusionsBySlug.get(candidate.routeId);
      const exclusionReasonCodes = exclusion?.reasonCodes ?? [];
      return {
        canonicalFacts: { candidate, exclusionReasonCodes },
        exclusionReasonCode: exclusionReasonCodes[0] ?? null,
        included: exclusion === undefined,
        ordinal: index + 1,
        routeId: requireDatabaseRouteId(routeIdsBySlug, candidate.routeId),
        simulationId
      };
    });
}

export function buildAllocationPersistenceRows(
  simulationId: string,
  capitalAmount: string,
  allocations: readonly PortfolioAllocation[],
  routeIdsBySlug: ReadonlyMap<string, string>
): AllocationPersistenceRow[] {
  if (allocations.length === 0) return [];
  const allocationTotal = allocations.reduce(
    (total, allocation) => total.plus(allocation.allocationPct),
    new Decimal(0)
  );
  if (!allocationTotal.eq(100)) {
    throw new Error(`Persisted allocation total must be 100 percent, received ${allocationTotal}`);
  }
  const capital = new Decimal(capitalAmount);
  if (!capital.isFinite() || !capital.isPositive()) {
    throw new Error("Persisted simulation capital must be a positive finite decimal");
  }
  const seenSlugs = new Set<string>();
  return [...allocations]
    .sort((left, right) => left.routeId.localeCompare(right.routeId))
    .map((allocation) => {
      if (seenSlugs.has(allocation.routeId)) {
        throw new Error(`Allocation route ${allocation.routeId} is duplicated`);
      }
      seenSlugs.add(allocation.routeId);
      const allocationRatio = new Decimal(allocation.allocationPct).div(100);
      if (!allocationRatio.isPositive() || allocationRatio.gt(1)) {
        throw new Error(`Allocation for ${allocation.routeId} is outside the valid range`);
      }
      return {
        allocatedAmount: decimalText(capital.mul(allocationRatio)),
        allocationRatio: decimalText(allocationRatio),
        comparativeRiskAdjustedApy: allocation.comparativeRiskAdjustedApy,
        grossApy: allocation.grossApy,
        netApy: allocation.netApy,
        rationale:
          allocation.rationaleCodes.length > 0
            ? allocation.rationaleCodes.join("|")
            : "DETERMINISTIC_OPTIMIZER_SELECTION",
        riskScore: allocation.riskScore,
        routeId: requireDatabaseRouteId(routeIdsBySlug, allocation.routeId),
        simulationId
      };
    });
}

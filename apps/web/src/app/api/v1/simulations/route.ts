import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  assets,
  chains,
  jurisdictions,
  productRoutes,
  riskMethodologyVersions,
  routeSimulationAllocations,
  routeSimulationCandidates,
  routeSimulations
} from "@rwa-yield-router/database";
import { optimizePortfolio } from "@rwa-yield-router/routing-engine";
import type { RouteCandidate } from "@rwa-yield-router/routing-engine";
import type { NextRequest } from "next/server";
import {
  apiError,
  checkRateLimit,
  JsonBodyError,
  readBoundedJson,
  requestIdentity,
  validateBrowserMutation
} from "@/lib/api";
import { authorizeMutation, type AuthorizedContext } from "@/lib/authz";
import { getLiveCatalog } from "@/lib/live-morpho";
import { getEffectivePublicReadModel } from "@/lib/public-read-model";
import { canonicalizeSimulationChainInputs } from "@/lib/simulation-chain-inputs";
import { buildSimulationCandidates } from "@/lib/simulation-candidates";
import {
  buildAllocationPersistenceRows,
  buildCandidatePersistenceRows
} from "@/lib/simulation-persistence";
import { simulationRequestSchema } from "@/lib/simulation-request";

const MAX_SIMULATION_REQUEST_BYTES = 16_384;

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!validateBrowserMutation(request.url, request.headers))
    return apiError(
      403,
      "AUTHORIZATION_DENIED",
      "Browser mutation validation failed.",
      correlationId
    );
  if (!(await checkRateLimit(`simulation:${requestIdentity(request.headers)}`, 20, 60_000)).allowed)
    return apiError(429, "RATE_LIMITED", "Simulation rate limit exceeded.", correlationId);
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_SIMULATION_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof JsonBodyError ? error.status : 400;
    return apiError(
      status,
      "VALIDATION_ERROR",
      status === 413
        ? "Simulation request exceeds the permitted size."
        : status === 415
          ? "Content type must be application/json."
          : "Request body must be valid JSON.",
      correlationId
    );
  }
  const parsed = simulationRequestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Simulation inputs are invalid.",
      correlationId,
      parsed.error.flatten()
    );
  let saveContext: AuthorizedContext | null = null;
  if (parsed.data.saveRequested) {
    const access = await authorizeMutation(request, { rateLimit: 10 });
    if (!access.ok) return access.response;
    saveContext = access.value;
  }

  const now = new Date().toISOString();
  const publicReadModel = await getEffectivePublicReadModel();
  if (publicReadModel.methodology === null)
    return apiError(
      503,
      "CONFIGURATION_UNAVAILABLE",
      "No complete currently effective published methodology is available.",
      correlationId
    );
  const methodologyVersion = publicReadModel.methodology.methodology.semanticVersion;
  const records = await getLiveCatalog();
  let candidates: RouteCandidate[];
  try {
    candidates = await buildSimulationCandidates();
  } catch {
    return apiError(
      503,
      "CONFIGURATION_UNAVAILABLE",
      "Current official route evidence could not be loaded safely.",
      correlationId
    );
  }
  const canonicalChains = canonicalizeSimulationChainInputs(
    records,
    candidates,
    parsed.data.currentChain,
    parsed.data.preferredChains
  );
  const result = await optimizePortfolio({
    candidates,
    input: {
      advancedResearchMode: parsed.data.advancedResearchMode,
      asOf: now,
      calculationVersion: "routing-calculation-v1.0.0",
      capitalUsd: parsed.data.capital,
      constraintOverrides: {
        maxChainExposurePct: parsed.data.maximumChainExposure,
        maxDefiExposurePct: parsed.data.maximumDefiExposure,
        maxGoldExposurePct: parsed.data.maximumGoldExposure,
        maxIssuerExposurePct: parsed.data.maximumIssuerExposure,
        maxProductAllocationPct: parsed.data.maximumProductAllocation,
        maxProtocolExposurePct: parsed.data.maximumProtocolExposure,
        maxRwaExposurePct: parsed.data.maximumRwaExposure,
        min24HourLiquidityPct: parsed.data.minimumTwentyFourHourLiquidity,
        min7DayLiquidityPct: parsed.data.minimumSevenDayLiquidity,
        minImmediateLiquidityPct: parsed.data.minimumImmediateLiquidity
      },
      currentAssetId: parsed.data.currentAsset,
      currentChainId: canonicalChains.currentChainId,
      excludedChains: [],
      excludedIssuerIds: [],
      excludedProductIds: [],
      excludedProtocolIds: [],
      holdingPeriodDays: parsed.data.holdingPeriodDays,
      incentiveYieldAcceptable: parsed.data.incentivesAcceptable,
      investorClassification: parsed.data.investorClassification,
      jurisdiction: parsed.data.jurisdiction.toUpperCase(),
      kycAcceptable: parsed.data.kycAcceptable,
      methodologyVersion,
      minimumAumOrTvlUsd: "0",
      minimumAvailableLiquidityUsd: "0",
      minimumDataConfidence: parsed.data.minimumConfidence,
      preferredAssets: [],
      preferredChains: [...canonicalChains.preferredChainIds],
      profile: parsed.data.profile
    }
  });
  const assumptions = [
    ...(parsed.data.advancedResearchMode
      ? [
          "Conditional eligibility and unknown KYC status were allowed because advanced research mode was explicitly selected."
        ]
      : []),
    ...(result.status === "FEASIBLE" && result.metrics.transactionCostStatus === "UNAVAILABLE"
      ? [
          "User-specific entry, exit, gas, and slippage costs are unavailable because no quote evidence is configured. This is a before-transaction-cost research scenario; after-cost net APY is unavailable."
        ]
      : [])
  ];
  const persistedResultSummary = { ...result, assumptions };

  let savedSimulationId: string | null = null;
  if (saveContext) {
    try {
      savedSimulationId = await saveContext.database.transaction(async (transaction) => {
        const [capitalAsset] = await transaction
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.symbol, "USD"),
              eq(assets.assetType, "FIAT"),
              eq(assets.lifecycleStatus, "ACTIVE"),
              isNull(assets.archivedAt)
            )
          )
          .limit(1);
        const [originChain] = await transaction
          .select({ id: chains.id })
          .from(chains)
          .where(
            and(
              sql`lower(${chains.name}) = ${parsed.data.currentChain.toLowerCase()}`,
              eq(chains.lifecycleStatus, "ACTIVE"),
              isNull(chains.archivedAt)
            )
          )
          .limit(1);
        const [jurisdiction] = await transaction
          .select({ id: jurisdictions.id })
          .from(jurisdictions)
          .where(eq(jurisdictions.isoCode, parsed.data.jurisdiction.toUpperCase()))
          .limit(1);
        const [methodology] = await transaction
          .select({ id: riskMethodologyVersions.id })
          .from(riskMethodologyVersions)
          .where(
            and(
              eq(riskMethodologyVersions.version, methodologyVersion),
              eq(riskMethodologyVersions.publicationStatus, "PUBLISHED")
            )
          )
          .limit(1);
        if (!capitalAsset || !methodology)
          throw new Error("Canonical simulation reference data is unavailable");
        const feasible = result.status === "FEASIBLE";
        const [saved] = await transaction
          .insert(routeSimulations)
          .values({
            allocationTotal: feasible ? "1.000000000000000000" : null,
            calculationVersion: result.calculationVersion,
            canonicalConstraints: {
              advancedResearchMode: parsed.data.advancedResearchMode,
              currentAsset: parsed.data.currentAsset,
              currentChain: parsed.data.currentChain,
              currentChainId: canonicalChains.currentChainId,
              incentivesAcceptable: parsed.data.incentivesAcceptable,
              investorClassification: parsed.data.investorClassification,
              jurisdiction: parsed.data.jurisdiction.toUpperCase(),
              kycAcceptable: parsed.data.kycAcceptable,
              maximumChainExposure: parsed.data.maximumChainExposure,
              maximumDefiExposure: parsed.data.maximumDefiExposure,
              maximumGoldExposure: parsed.data.maximumGoldExposure,
              maximumIssuerExposure: parsed.data.maximumIssuerExposure,
              maximumProductAllocation: parsed.data.maximumProductAllocation,
              maximumProtocolExposure: parsed.data.maximumProtocolExposure,
              maximumRwaExposure: parsed.data.maximumRwaExposure,
              minimumConfidence: parsed.data.minimumConfidence,
              minimumImmediateLiquidity: parsed.data.minimumImmediateLiquidity,
              minimumSevenDayLiquidity: parsed.data.minimumSevenDayLiquidity,
              minimumTwentyFourHourLiquidity: parsed.data.minimumTwentyFourHourLiquidity,
              preferredChainIds: canonicalChains.preferredChainIds,
              preferredChains: parsed.data.preferredChains
            },
            capitalAmount: parsed.data.capital,
            capitalAssetId: capitalAsset.id,
            comparativeRiskAdjustedApy: feasible ? result.metrics.comparativeRiskAdjustedApy : null,
            completedAt: new Date(),
            dataConfidenceScore: feasible ? result.metrics.dataConfidenceScore : null,
            dataCutoff: new Date(result.dataTimestamp),
            disclosureVersion: "analytical-disclosure-v2",
            grossBlendedApy: feasible ? result.metrics.grossBlendedApy : null,
            holdingPeriodDays: parsed.data.holdingPeriodDays,
            infeasibilityDiagnostics: result.status === "INFEASIBLE" ? result.diagnostics : null,
            investorClassification: parsed.data.investorClassification,
            isSaved: true,
            jurisdictionId: jurisdiction?.id ?? null,
            methodologyVersionId: methodology.id,
            name: parsed.data.name ?? `Simulation ${new Date().toISOString().slice(0, 10)}`,
            netBlendedApy: feasible ? result.metrics.netBlendedApy : null,
            resultSummary: persistedResultSummary,
            riskProfile: parsed.data.profile,
            originChainId: originChain?.id ?? null,
            solverVersion: result.solverVersion,
            status:
              result.status === "FEASIBLE"
                ? "FEASIBLE"
                : result.status === "INFEASIBLE"
                  ? "INFEASIBLE"
                  : "FAILED",
            userId: saveContext.authorization.userId,
            weightedRiskScore: feasible ? result.metrics.weightedRiskScore : null
          })
          .returning({ id: routeSimulations.id });
        if (!saved) throw new Error("Saved simulation invariant failed");
        const routeReferences =
          candidates.length === 0
            ? []
            : await transaction
                .select({ id: productRoutes.id, slug: productRoutes.slug })
                .from(productRoutes)
                .where(
                  and(
                    inArray(
                      productRoutes.slug,
                      candidates.map((candidate) => candidate.routeId)
                    ),
                    eq(productRoutes.publicationStatus, "PUBLISHED"),
                    eq(productRoutes.lifecycleStatus, "ACTIVE"),
                    isNull(productRoutes.effectiveTo),
                    isNull(productRoutes.archivedAt)
                  )
                );
        const routeIdsBySlug = new Map(
          routeReferences.map((reference) => [reference.slug, reference.id])
        );
        const candidateRows = buildCandidatePersistenceRows(
          saved.id,
          candidates,
          result.excludedCandidates,
          routeIdsBySlug
        );
        if (candidateRows.length > 0) {
          await transaction.insert(routeSimulationCandidates).values(candidateRows);
        }
        const allocationRows = buildAllocationPersistenceRows(
          saved.id,
          parsed.data.capital,
          result.allocations,
          routeIdsBySlug
        );
        if (allocationRows.length > 0) {
          await transaction.insert(routeSimulationAllocations).values(allocationRows);
        }
        return saved.id;
      });
    } catch {
      return apiError(
        503,
        "CONFIGURATION_UNAVAILABLE",
        "The simulation was calculated but could not be saved because canonical database reference data is unavailable.",
        correlationId
      );
    }
  }

  if (result.status === "FEASIBLE") {
    return Response.json(
      {
        allocations: result.allocations.map((allocation) => {
          const record = records.find((candidate) => candidate.slug === allocation.routeId);
          return {
            percentage: allocation.allocationPct,
            productName: record?.productName ?? "Sourced product",
            rationale: allocation.rationaleCodes
              .map((code) => code.replaceAll("_", " ").toLowerCase())
              .join("; "),
            comparativeRiskAdjustedApy: allocation.comparativeRiskAdjustedApy,
            comparativeRiskAdjustedApyBeforeTransactionCosts:
              allocation.comparativeRiskAdjustedApyBeforeTransactionCosts,
            netApy: allocation.netApy,
            netApyBeforeTransactionCosts: allocation.netApyBeforeTransactionCosts,
            riskScore: allocation.riskScore,
            routeName: record?.routeName ?? allocation.routeId,
            routeSlug: record?.slug ?? allocation.routeId,
            transactionCostStatus: allocation.transactionCostStatus
          };
        }),
        assumptions,
        comparativeRiskAdjustedApy: result.metrics.comparativeRiskAdjustedApy,
        comparativeRiskAdjustedApyBeforeTransactionCosts:
          result.metrics.comparativeRiskAdjustedApyBeforeTransactionCosts,
        dataTimestamp: result.dataTimestamp,
        grossBlendedApy: result.metrics.grossBlendedApy,
        immediateLiquidity: result.metrics.liquidity.immediatePct,
        methodologyVersion: result.methodologyVersion,
        netBlendedApy: result.metrics.netBlendedApy,
        netBlendedApyBeforeTransactionCosts: result.metrics.netBlendedApyBeforeTransactionCosts,
        savedSimulationId,
        sevenDayLiquidity: result.metrics.liquidity.within7DaysPct,
        status: "FEASIBLE",
        transactionCostStatus: result.metrics.transactionCostStatus,
        twentyFourHourLiquidity: result.metrics.liquidity.within24HoursPct,
        weightedRiskScore: result.metrics.weightedRiskScore
      },
      { headers: { "cache-control": "no-store", "x-correlation-id": correlationId } }
    );
  }

  const diagnostics: Array<{ code: string; message: string; suggestedChange?: string }> =
    result.status === "INFEASIBLE"
      ? result.diagnostics.conflicts.map((conflict) => ({
          code: conflict.code,
          message: conflict.label,
          ...(conflict.suggestedValue === null
            ? {}
            : {
                suggestedChange: `Consider ${conflict.suggestedValue} instead of ${conflict.currentValue}.`
              })
        }))
      : [
          {
            code: result.reason,
            message: "The deterministic solver was unavailable or failed independent validation."
          }
        ];
  if (diagnostics.length === 0)
    diagnostics.push({
      code: "NO_ELIGIBLE_CANDIDATE",
      message:
        "No published route has the complete current yield, risk, liquidity, eligibility, and provenance required for standard optimization."
    });
  return Response.json(
    {
      dataTimestamp: result.dataTimestamp,
      diagnostics,
      excludedCount: result.excludedCandidates.length,
      methodologyVersion: result.methodologyVersion,
      savedSimulationId,
      status: "INFEASIBLE"
    },
    { headers: { "cache-control": "no-store", "x-correlation-id": correlationId } }
  );
}

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assets, riskMethodologyVersions, routeSimulations } from "@rwa-yield-router/database";
import { optimizePortfolio } from "@rwa-yield-router/routing-engine";
import type { RouteCandidate } from "@rwa-yield-router/routing-engine";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, checkRateLimit, requestIdentity, validateBrowserMutation } from "@/lib/api";
import { authorizeMutation, type AuthorizedContext } from "@/lib/authz";
import { getLiveCatalog } from "@/lib/live-morpho";
import { getEffectivePublicReadModel } from "@/lib/public-read-model";
import { buildSimulationCandidates } from "@/lib/simulation-candidates";

const requestSchema = z
  .object({
    advancedResearchMode: z.boolean().default(false),
    capital: z.string(),
    currentAsset: z.string().min(1).max(128),
    currentChain: z.string().min(1).max(128),
    holdingPeriodDays: z.string(),
    incentivesAcceptable: z.boolean(),
    investorClassification: z.enum([
      "RETAIL",
      "ACCREDITED",
      "QUALIFIED",
      "PROFESSIONAL",
      "INSTITUTIONAL"
    ]),
    jurisdiction: z.string().min(2).max(3),
    kycAcceptable: z.boolean(),
    maximumChainExposure: z.string(),
    maximumDefiExposure: z.string(),
    maximumGoldExposure: z.string(),
    maximumIssuerExposure: z.string(),
    maximumProductAllocation: z.string(),
    maximumProtocolExposure: z.string(),
    maximumRwaExposure: z.string(),
    minimumConfidence: z.enum([
      "VERIFIED_OFFICIAL",
      "ONCHAIN_DERIVED",
      "DIRECT_API",
      "MANUALLY_VERIFIED",
      "THIRD_PARTY"
    ]),
    minimumImmediateLiquidity: z.string(),
    minimumSevenDayLiquidity: z.string(),
    minimumTwentyFourHourLiquidity: z.string(),
    preferredChains: z.array(z.string().min(1).max(128)).max(20),
    profile: z.enum([
      "CAPITAL_PRESERVATION",
      "CONSERVATIVE",
      "BALANCED",
      "YIELD_SEEKING",
      "CUSTOM"
    ]),
    saveRequested: z.boolean().default(false),
    name: z.string().trim().min(1).max(120).optional()
  })
  .strict();

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
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.", correlationId);
  }
  const parsed = requestSchema.safeParse(body);
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
      currentChainId: parsed.data.currentChain,
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
      preferredChains: parsed.data.preferredChains,
      profile: parsed.data.profile
    }
  });

  let savedSimulationId: string | null = null;
  if (saveContext) {
    try {
      savedSimulationId = await saveContext.database.transaction(async (transaction) => {
        const symbol = parsed.data.currentAsset.trim().toUpperCase();
        let [asset] = await transaction
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.symbol, symbol), eq(assets.lifecycleStatus, "ACTIVE")))
          .limit(1);
        if (!asset) {
          [asset] = await transaction
            .insert(assets)
            .values({
              assetType: "SIMULATION_INPUT",
              name: parsed.data.currentAsset.trim(),
              symbol
            })
            .returning({ id: assets.id });
        }
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
        if (!asset || !methodology)
          throw new Error("Canonical simulation reference data is unavailable");
        const feasible = result.status === "FEASIBLE";
        const [saved] = await transaction
          .insert(routeSimulations)
          .values({
            allocationTotal: feasible ? "1.000000000000000000" : null,
            calculationVersion: result.calculationVersion,
            canonicalConstraints: {
              advancedResearchMode: parsed.data.advancedResearchMode,
              incentivesAcceptable: parsed.data.incentivesAcceptable,
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
              preferredChains: parsed.data.preferredChains
            },
            capitalAmount: parsed.data.capital,
            capitalAssetId: asset.id,
            comparativeRiskAdjustedApy: feasible ? result.metrics.comparativeRiskAdjustedApy : null,
            completedAt: new Date(),
            dataConfidenceScore: feasible ? result.metrics.dataConfidenceScore : null,
            dataCutoff: new Date(result.dataTimestamp),
            disclosureVersion: "analytical-disclosure-v1",
            grossBlendedApy: feasible ? result.metrics.grossBlendedApy : null,
            holdingPeriodDays: parsed.data.holdingPeriodDays,
            infeasibilityDiagnostics: result.status === "INFEASIBLE" ? result.diagnostics : null,
            investorClassification: parsed.data.investorClassification,
            isSaved: true,
            methodologyVersionId: methodology.id,
            name: parsed.data.name ?? `Simulation ${new Date().toISOString().slice(0, 10)}`,
            netBlendedApy: feasible ? result.metrics.netBlendedApy : null,
            resultSummary: result,
            riskProfile: parsed.data.profile,
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
            riskAdjustedApy: allocation.comparativeRiskAdjustedApy,
            riskScore: allocation.riskScore,
            routeName: record?.routeName ?? allocation.routeId,
            routeSlug: record?.slug ?? allocation.routeId
          };
        }),
        assumptions: parsed.data.advancedResearchMode
          ? [
              "Conditional eligibility and unknown KYC status were allowed because advanced research mode was explicitly selected.",
              "User transaction costs are unavailable without a configured quote provider and are modeled as zero; net route APY therefore remains before user transaction costs."
            ]
          : [],
        dataTimestamp: result.dataTimestamp,
        grossBlendedApy: result.metrics.grossBlendedApy,
        immediateLiquidity: result.metrics.liquidity.immediatePct,
        methodologyVersion: result.methodologyVersion,
        netBlendedApy: result.metrics.netBlendedApy,
        riskAdjustedApy: result.metrics.comparativeRiskAdjustedApy,
        savedSimulationId,
        sevenDayLiquidity: result.metrics.liquidity.within7DaysPct,
        status: "FEASIBLE",
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

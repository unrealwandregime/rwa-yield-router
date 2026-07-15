import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { CATEGORY_META } from "@/lib/constants";
import { getLiveCatalog } from "@/lib/live-morpho";
import { getEffectiveMethodology } from "@/lib/public-read-model";
import {
  apiError,
  checkRateLimit,
  decodeCursor,
  encodeCursor,
  jsonWithEtag,
  paginationSchema,
  requestIdentity
} from "@/lib/api";

type RouteContext = { params: Promise<{ resource: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = randomUUID();
  const rate = await checkRateLimit(`public:${requestIdentity(request.headers)}`, 120, 60_000);
  if (!rate.allowed)
    return apiError(429, "RATE_LIMITED", "Public API rate limit exceeded.", correlationId);
  const { resource } = await context.params;
  const parsedPagination = paginationSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsedPagination.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Invalid pagination parameters.",
      correlationId,
      parsedPagination.error.flatten()
    );

  const records = await getLiveCatalog();
  const observedAt =
    records
      .map((record) => record.observedAt)
      .filter((value): value is string => value !== null)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  let data: unknown[];

  switch (resource) {
    case "products": {
      const unique = new Map<string, unknown>();
      for (const record of records)
        unique.set(record.productSlug, {
          category: record.category,
          confidence: record.confidence,
          issuer: record.issuer,
          lifecycleStatus: record.lifecycleStatus,
          name: record.productName,
          nativeYield: record.nativeYield,
          slug: record.productSlug,
          source: record.source,
          symbol: record.symbol,
          verifiedAt: record.verifiedAt
        });
      data = [...unique.values()];
      break;
    }
    case "routes":
      data = records;
      break;
    case "yield":
      data = records.map((record) => ({
        grossApy: record.grossApy,
        netApy: record.netApy,
        observedAt: record.observedAt,
        riskAdjustedApy: record.riskAdjustedApy,
        routeSlug: record.slug,
        source: record.source,
        status: record.metricStatus.yield.status
      }));
      break;
    case "risk":
      data = records.map((record) => ({
        confidence: record.confidence,
        methodologyVersion: record.methodologyVersion,
        riskAdjustedApy: record.riskAdjustedApy,
        riskScore: record.riskScore,
        routeSlug: record.slug,
        status: record.metricStatus.risk.status
      }));
      break;
    case "liquidity":
      data = records.map((record) => ({
        availableLiquidityUsd: record.liquidityUsd,
        observedAt: record.observedAt,
        redemptionSummary: record.redemptionSummary,
        routeSlug: record.slug,
        status: record.metricStatus.liquidity.status
      }));
      break;
    case "aum-tvl":
      data = records.map((record) => ({
        amountUsd: record.aumTvlUsd,
        observedAt: record.observedAt,
        routeSlug: record.slug,
        status: record.metricStatus.aumTvl.status
      }));
      break;
    case "sources": {
      const unique = new Map<string, (typeof records)[number]["source"]>();
      for (const record of records) {
        unique.set(record.identitySource.url, record.identitySource);
        unique.set(record.source.url, record.source);
      }
      data = [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
      break;
    }
    case "categories":
      data = Object.entries(CATEGORY_META).map(([category, meta]) => ({
        admittedRoutes: records.filter(
          (record) => record.category === category && record.publicationStatus === "PUBLISHED"
        ).length,
        category,
        description: meta.description,
        label: meta.label,
        researchedRecords: records.filter((record) => record.category === category).length
      }));
      break;
    case "methodologies": {
      const effective = await getEffectiveMethodology();
      data =
        effective === null
          ? [
              {
                effectiveAt: null,
                label: "No compatible currently effective publication",
                published: false,
                status: "UNAVAILABLE",
                version: null
              }
            ]
          : [
              {
                calculationVersion: effective.calculationVersion,
                description: effective.description,
                effectiveAt: effective.methodology.effectiveAt,
                label: `Comparative risk methodology ${effective.methodology.semanticVersion}`,
                minimumEvidenceCoveragePct: effective.methodology.minimumEvidenceCoveragePct,
                published: true,
                publishedAt: effective.methodology.publishedAt,
                source: effective.source,
                status: "CURRENT",
                unknownRiskProxy: effective.methodology.unknownRiskProxy,
                version: effective.methodology.semanticVersion,
                weights: effective.methodology.categoryWeights
              }
            ];
      break;
    }
    default:
      return apiError(404, "NOT_FOUND", "Unknown public API resource.", correlationId);
  }

  const offset = decodeCursor(parsedPagination.data.cursor);
  const page = data.slice(offset, offset + parsedPagination.data.limit);
  const nextOffset = offset + page.length;
  return jsonWithEtag({
    data: page,
    meta: {
      correlationId,
      count: page.length,
      dataTimestamp: observedAt,
      nextCursor: nextOffset < data.length ? encodeCursor(nextOffset) : null,
      sourceTimestamp:
        records.map((record) => record.verifiedAt).sort((a, b) => b.localeCompare(a))[0] ?? null,
      total: data.length
    }
  });
}

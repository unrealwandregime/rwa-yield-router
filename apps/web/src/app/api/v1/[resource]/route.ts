import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { CATEGORY_META } from "@/lib/constants";
import { latestHistorySourceTimestamp, serializeYieldHistoryPoint } from "@/lib/history-contract";
import { getYieldHistory } from "@/lib/history";
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

const PUBLIC_READ_RATE_LIMIT_PER_MINUTE = 600;

const routeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const comparisonRoutesSchema = z
  .array(routeSlugSchema)
  .min(2)
  .max(5)
  .refine((routes) => new Set(routes).size === routes.length, "Routes must be unique.");

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = randomUUID();
  const rate = await checkRateLimit(
    `public:${requestIdentity(request.headers)}`,
    PUBLIC_READ_RATE_LIMIT_PER_MINUTE,
    60_000
  );
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
  let dataTimestamp = observedAt;
  let sourceTimestamp =
    records.map((record) => record.verifiedAt).sort((a, b) => b.localeCompare(a))[0] ?? null;
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
    case "historical-yield": {
      const parsedRoute = routeSlugSchema.safeParse(request.nextUrl.searchParams.get("route"));
      if (!parsedRoute.success)
        return apiError(
          400,
          "VALIDATION_ERROR",
          "A valid route slug is required for historical yield.",
          correlationId,
          parsedRoute.error.flatten()
        );
      const route = records.find((record) => record.slug === parsedRoute.data);
      if (!route) return apiError(404, "NOT_FOUND", "Sourced route not found.", correlationId);
      const history = await getYieldHistory(route.slug);
      data = history.map((point) => serializeYieldHistoryPoint(point, route.slug));
      dataTimestamp = history.at(-1)?.at ?? null;
      sourceTimestamp = latestHistorySourceTimestamp(history);
      break;
    }
    case "comparison": {
      const parsedRoutes = comparisonRoutesSchema.safeParse(
        request.nextUrl.searchParams
          .getAll("routes")
          .flatMap((value) => value.split(","))
          .map((value) => value.trim())
          .filter(Boolean)
      );
      if (!parsedRoutes.success)
        return apiError(
          400,
          "VALIDATION_ERROR",
          "Comparison requires two to five unique route slugs.",
          correlationId,
          parsedRoutes.error.flatten()
        );
      const bySlug = new Map(records.map((record) => [record.slug, record]));
      const missing = parsedRoutes.data.filter((slug) => !bySlug.has(slug));
      if (missing.length > 0)
        return apiError(
          404,
          "NOT_FOUND",
          "One or more comparison routes were not found.",
          correlationId,
          { missing }
        );
      const comparisonRecords = parsedRoutes.data.flatMap((slug) => {
        const record = bySlug.get(slug);
        return record === undefined ? [] : [record];
      });
      data = comparisonRecords;
      dataTimestamp =
        comparisonRecords
          .flatMap((record) => (record.observedAt === null ? [] : [record.observedAt]))
          .sort((a, b) => b.localeCompare(a))[0] ?? null;
      sourceTimestamp =
        comparisonRecords
          .map((record) => record.verifiedAt)
          .sort((a, b) => b.localeCompare(a))[0] ?? null;
      break;
    }
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
      dataTimestamp,
      nextCursor: nextOffset < data.length ? encodeCursor(nextOffset) : null,
      sourceTimestamp,
      total: data.length
    }
  });
}

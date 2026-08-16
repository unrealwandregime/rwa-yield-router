import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError, checkRateLimit, jsonWithEtag, requestIdentity } from "@/lib/api";
import { getYieldHistory } from "@/lib/history";
import { latestHistorySourceTimestamp, serializeYieldHistoryPoint } from "@/lib/history-contract";
import { getLiveCatalog } from "@/lib/live-morpho";

type RouteContext = { params: Promise<{ resource: string; slug: string }> };

const PUBLIC_READ_RATE_LIMIT_PER_MINUTE = 600;

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = randomUUID();
  if (
    !(
      await checkRateLimit(
        `public:${requestIdentity(request.headers)}`,
        PUBLIC_READ_RATE_LIMIT_PER_MINUTE,
        60_000
      )
    ).allowed
  )
    return apiError(429, "RATE_LIMITED", "Public API rate limit exceeded.", correlationId);
  const { resource, slug } = await context.params;
  const catalog = await getLiveCatalog();
  const route = catalog.find((record) =>
    resource === "products" ? record.productSlug === slug : record.slug === slug
  );
  if (!route) return apiError(404, "NOT_FOUND", "Sourced record not found.", correlationId);
  if (resource === "historical-yield") {
    const history = await getYieldHistory(route.slug);
    return jsonWithEtag({
      data: history.map((point) => serializeYieldHistoryPoint(point, route.slug)),
      meta: {
        correlationId,
        dataTimestamp: history.at(-1)?.at ?? null,
        sourceTimestamp: latestHistorySourceTimestamp(history)
      }
    });
  }
  if (resource === "routes")
    return jsonWithEtag({
      data: route,
      meta: { correlationId, dataTimestamp: route.observedAt, sourceTimestamp: route.verifiedAt }
    });
  if (resource === "products") {
    const relatedRoutes = catalog.filter((record) => record.productSlug === route.productSlug);
    return jsonWithEtag({
      data: {
        category: route.category,
        issuer: route.issuer,
        name: route.productName,
        nativeYield: route.nativeYield,
        relatedRoutes,
        slug: route.productSlug,
        source: route.source,
        symbol: route.symbol
      },
      meta: { correlationId, sourceTimestamp: route.verifiedAt }
    });
  }
  return apiError(404, "NOT_FOUND", "Unknown public API resource.", correlationId);
}

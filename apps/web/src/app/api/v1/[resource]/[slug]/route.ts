import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError, checkRateLimit, jsonWithEtag, requestIdentity } from "@/lib/api";
import { getLiveCatalog } from "@/lib/live-morpho";

type RouteContext = { params: Promise<{ resource: string; slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const correlationId = randomUUID();
  if (!(await checkRateLimit(`public:${requestIdentity(request.headers)}`, 120, 60_000)).allowed)
    return apiError(429, "RATE_LIMITED", "Public API rate limit exceeded.", correlationId);
  const { resource, slug } = await context.params;
  const catalog = await getLiveCatalog();
  const route = catalog.find((record) =>
    resource === "products" ? record.productSlug === slug : record.slug === slug
  );
  if (!route) return apiError(404, "NOT_FOUND", "Sourced record not found.", correlationId);
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

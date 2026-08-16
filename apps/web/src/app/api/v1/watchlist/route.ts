import { and, desc, eq, isNull } from "drizzle-orm";
import { products, productRoutes, watchlistItems, watchlists } from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";

const watchlistRequestSchema = z.object({ routeSlug: z.string().min(1).max(160) }).strict();

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request);
  if (!access.ok) return access.response;
  const rows = await access.value.database
    .select({
      addedAt: watchlistItems.createdAt,
      id: watchlistItems.id,
      productName: products.name,
      routeName: productRoutes.name,
      routeSlug: productRoutes.slug
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .innerJoin(productRoutes, eq(watchlistItems.routeId, productRoutes.id))
    .innerJoin(products, eq(productRoutes.productId, products.id))
    .where(
      and(eq(watchlists.userId, access.value.authorization.userId), isNull(watchlists.archivedAt))
    )
    .orderBy(desc(watchlistItems.createdAt));
  return Response.json({ data: rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = watchlistRequestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Watchlist input is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const { authorization, database } = access.value;
  const [route] = await database
    .select({ id: productRoutes.id })
    .from(productRoutes)
    .where(
      and(
        eq(productRoutes.slug, parsed.data.routeSlug),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        eq(productRoutes.lifecycleStatus, "ACTIVE"),
        isNull(productRoutes.archivedAt)
      )
    )
    .limit(1);
  if (!route) return apiError(404, "NOT_FOUND", "Published route not found.");
  const watchlist = await database.transaction(async (transaction) => {
    await transaction
      .insert(watchlists)
      .values({ name: "Primary", userId: authorization.userId })
      .onConflictDoNothing({ target: [watchlists.userId, watchlists.name] });
    const [list] = await transaction
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(
        and(
          eq(watchlists.userId, authorization.userId),
          eq(watchlists.name, "Primary"),
          isNull(watchlists.archivedAt)
        )
      )
      .limit(1);
    if (!list) throw new Error("Watchlist invariant failed");
    await transaction
      .insert(watchlistItems)
      .values({ routeId: route.id, watchlistId: list.id })
      .onConflictDoNothing({ target: [watchlistItems.watchlistId, watchlistItems.routeId] });
    return list;
  });
  return Response.json(
    { data: { id: watchlist.id }, status: "CREATED" },
    { headers: { "cache-control": "no-store" }, status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  const parsed = watchlistRequestSchema.safeParse({
    routeSlug: request.nextUrl.searchParams.get("routeSlug")
  });
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "A valid route slug is required.",
      undefined,
      parsed.error.flatten()
    );
  const { authorization, database } = access.value;
  const [target] = await database
    .select({ itemId: watchlistItems.id })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .innerJoin(productRoutes, eq(watchlistItems.routeId, productRoutes.id))
    .where(
      and(
        eq(watchlists.userId, authorization.userId),
        eq(productRoutes.slug, parsed.data.routeSlug),
        isNull(watchlists.archivedAt)
      )
    )
    .limit(1);
  if (!target) return apiError(404, "NOT_FOUND", "Watchlist item not found.");
  await database.delete(watchlistItems).where(eq(watchlistItems.id, target.itemId));
  return Response.json({ status: "DELETED" }, { headers: { "cache-control": "no-store" } });
}

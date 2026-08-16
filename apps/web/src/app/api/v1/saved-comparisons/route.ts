import {
  productRoutes,
  products,
  savedComparisonItems,
  savedComparisons,
  type Database
} from "@rwa-yield-router/database";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";
import {
  isSavableRouteState,
  savedComparisonCreateSchema,
  savedComparisonUpdateSchema,
  savedObjectIdSchema
} from "@/lib/saved-research-contract";

const parseJson = async (request: NextRequest): Promise<unknown | null> => {
  try {
    return await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return null;
  }
};

const resolveCurrentRoutes = async (database: Database, routeSlugs: readonly string[]) => {
  const rows = await database
    .select({
      archivedAt: productRoutes.archivedAt,
      effectiveTo: productRoutes.effectiveTo,
      id: productRoutes.id,
      lifecycleStatus: productRoutes.lifecycleStatus,
      publicationStatus: productRoutes.publicationStatus,
      slug: productRoutes.slug
    })
    .from(productRoutes)
    .where(
      and(
        inArray(productRoutes.slug, [...routeSlugs]),
        eq(productRoutes.lifecycleStatus, "ACTIVE"),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        isNull(productRoutes.effectiveTo),
        isNull(productRoutes.archivedAt)
      )
    );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const ordered = routeSlugs.flatMap((slug) => {
    const route = bySlug.get(slug);
    return route === undefined || !isSavableRouteState(route) ? [] : [route];
  });
  return ordered.length === routeSlugs.length ? ordered : null;
};

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request, { rateLimit: 60 });
  if (!access.ok) return access.response;
  const { authorization, database } = access.value;
  try {
    const comparisons = await database
      .select({
        createdAt: savedComparisons.createdAt,
        id: savedComparisons.id,
        name: savedComparisons.name,
        updatedAt: savedComparisons.updatedAt
      })
      .from(savedComparisons)
      .where(
        and(eq(savedComparisons.userId, authorization.userId), isNull(savedComparisons.archivedAt))
      )
      .orderBy(desc(savedComparisons.updatedAt));
    if (comparisons.length === 0)
      return Response.json({ data: [] }, { headers: { "cache-control": "no-store" } });

    const comparisonIds = comparisons.map((comparison) => comparison.id);
    const itemRows = await database
      .select({
        comparisonId: savedComparisonItems.comparisonId,
        position: savedComparisonItems.position,
        productName: products.name,
        routeName: productRoutes.name,
        routeSlug: productRoutes.slug
      })
      .from(savedComparisonItems)
      .innerJoin(savedComparisons, eq(savedComparisonItems.comparisonId, savedComparisons.id))
      .innerJoin(productRoutes, eq(savedComparisonItems.routeId, productRoutes.id))
      .innerJoin(products, eq(productRoutes.productId, products.id))
      .where(
        and(
          eq(savedComparisons.userId, authorization.userId),
          isNull(savedComparisons.archivedAt),
          inArray(savedComparisonItems.comparisonId, comparisonIds)
        )
      )
      .orderBy(savedComparisonItems.position);
    return Response.json(
      {
        data: comparisons.map((comparison) => ({
          ...comparison,
          items: itemRows
            .filter((item) => item.comparisonId === comparison.id)
            .map((item) => ({
              position: item.position,
              productName: item.productName,
              routeName: item.routeName,
              routeSlug: item.routeSlug
            }))
        }))
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Saved comparisons are unavailable.");
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 20 });
  if (!access.ok) return access.response;
  const parsed = savedComparisonCreateSchema.safeParse(await parseJson(request));
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Saved comparison input is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const { authorization, database } = access.value;
  try {
    const routes = await resolveCurrentRoutes(database, parsed.data.routeSlugs);
    if (routes === null)
      return apiError(404, "NOT_FOUND", "One or more current catalog routes were not found.");
    const created = await database.transaction(async (transaction) => {
      const [comparison] = await transaction
        .insert(savedComparisons)
        .values({ name: parsed.data.name, userId: authorization.userId })
        .returning({ id: savedComparisons.id });
      if (comparison === undefined) throw new Error("Saved comparison was not created");
      await transaction.insert(savedComparisonItems).values(
        routes.map((route, index) => ({
          comparisonId: comparison.id,
          position: index + 1,
          routeId: route.id
        }))
      );
      return comparison;
    });
    return Response.json(
      { data: created, status: "CREATED" },
      { headers: { "cache-control": "no-store" }, status: 201 }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The comparison could not be saved. Use a unique name and try again."
    );
  }
}

export async function PATCH(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 20 });
  if (!access.ok) return access.response;
  const parsed = savedComparisonUpdateSchema.safeParse(await parseJson(request));
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Saved comparison update is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const { authorization, database } = access.value;
  try {
    const routes =
      parsed.data.routeSlugs === undefined
        ? undefined
        : await resolveCurrentRoutes(database, parsed.data.routeSlugs);
    if (routes === null)
      return apiError(404, "NOT_FOUND", "One or more current catalog routes were not found.");
    const updated = await database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ id: savedComparisons.id })
        .from(savedComparisons)
        .where(
          and(
            eq(savedComparisons.id, parsed.data.id),
            eq(savedComparisons.userId, authorization.userId),
            isNull(savedComparisons.archivedAt)
          )
        )
        .limit(1);
      if (owned === undefined) return null;
      await transaction
        .update(savedComparisons)
        .set({
          ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
          updatedAt: new Date()
        })
        .where(
          and(
            eq(savedComparisons.id, owned.id),
            eq(savedComparisons.userId, authorization.userId),
            isNull(savedComparisons.archivedAt)
          )
        );
      if (routes !== undefined) {
        await transaction
          .delete(savedComparisonItems)
          .where(eq(savedComparisonItems.comparisonId, owned.id));
        await transaction.insert(savedComparisonItems).values(
          routes.map((route, index) => ({
            comparisonId: owned.id,
            position: index + 1,
            routeId: route.id
          }))
        );
      }
      return owned;
    });
    if (updated === null) return apiError(404, "NOT_FOUND", "Saved comparison not found.");
    return Response.json(
      { data: updated, status: "UPDATED" },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The comparison could not be updated. Use a unique name and try again."
    );
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 20 });
  if (!access.ok) return access.response;
  const parsed = savedObjectIdSchema.safeParse({ id: request.nextUrl.searchParams.get("id") });
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "A valid saved comparison id is required.",
      undefined,
      parsed.error.flatten()
    );
  try {
    const [archived] = await access.value.database
      .update(savedComparisons)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(savedComparisons.id, parsed.data.id),
          eq(savedComparisons.userId, access.value.authorization.userId),
          isNull(savedComparisons.archivedAt)
        )
      )
      .returning({ id: savedComparisons.id });
    if (archived === undefined) return apiError(404, "NOT_FOUND", "Saved comparison not found.");
    return Response.json(
      { data: archived, status: "ARCHIVED" },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "The comparison could not be archived.");
  }
}

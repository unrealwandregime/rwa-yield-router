import { savedViews } from "@rwa-yield-router/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";
import {
  savedObjectIdSchema,
  savedViewCreateSchema,
  savedViewStateSchema,
  savedViewUpdateSchema
} from "@/lib/saved-research-contract";

const parseJson = async (request: NextRequest): Promise<unknown | null> => {
  try {
    return await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request, { rateLimit: 60 });
  if (!access.ok) return access.response;
  try {
    const rows = await access.value.database
      .select({
        createdAt: savedViews.createdAt,
        filters: savedViews.filters,
        id: savedViews.id,
        name: savedViews.name,
        sort: savedViews.sort,
        updatedAt: savedViews.updatedAt,
        visibleColumns: savedViews.visibleColumns
      })
      .from(savedViews)
      .where(
        and(eq(savedViews.userId, access.value.authorization.userId), isNull(savedViews.archivedAt))
      )
      .orderBy(desc(savedViews.updatedAt));
    const data = rows.flatMap((row) => {
      const state = savedViewStateSchema.safeParse({
        filters: row.filters,
        sort: row.sort,
        visibleColumns: row.visibleColumns
      });
      return state.success
        ? [
            {
              createdAt: row.createdAt,
              id: row.id,
              name: row.name,
              updatedAt: row.updatedAt,
              ...state.data
            }
          ]
        : [];
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Saved views are unavailable.");
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 20 });
  if (!access.ok) return access.response;
  const parsed = savedViewCreateSchema.safeParse(await parseJson(request));
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Saved view input is invalid.",
      undefined,
      parsed.error.flatten()
    );
  try {
    const [created] = await access.value.database
      .insert(savedViews)
      .values({
        filters: parsed.data.filters,
        name: parsed.data.name,
        sort: parsed.data.sort,
        userId: access.value.authorization.userId,
        visibleColumns: parsed.data.visibleColumns
      })
      .returning({ id: savedViews.id });
    if (created === undefined) throw new Error("Saved view was not created");
    return Response.json(
      { data: created, status: "CREATED" },
      { headers: { "cache-control": "no-store" }, status: 201 }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The view could not be saved. Use a unique name and try again."
    );
  }
}

export async function PATCH(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 20 });
  if (!access.ok) return access.response;
  const parsed = savedViewUpdateSchema.safeParse(await parseJson(request));
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Saved view update is invalid.",
      undefined,
      parsed.error.flatten()
    );
  try {
    const [updated] = await access.value.database
      .update(savedViews)
      .set({
        filters: parsed.data.filters,
        name: parsed.data.name,
        sort: parsed.data.sort,
        updatedAt: new Date(),
        visibleColumns: parsed.data.visibleColumns
      })
      .where(
        and(
          eq(savedViews.id, parsed.data.id),
          eq(savedViews.userId, access.value.authorization.userId),
          isNull(savedViews.archivedAt)
        )
      )
      .returning({ id: savedViews.id });
    if (updated === undefined) return apiError(404, "NOT_FOUND", "Saved view not found.");
    return Response.json(
      { data: updated, status: "UPDATED" },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The view could not be updated. Use a unique name and try again."
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
      "A valid saved view id is required.",
      undefined,
      parsed.error.flatten()
    );
  try {
    const [archived] = await access.value.database
      .update(savedViews)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(savedViews.id, parsed.data.id),
          eq(savedViews.userId, access.value.authorization.userId),
          isNull(savedViews.archivedAt)
        )
      )
      .returning({ id: savedViews.id });
    if (archived === undefined) return apiError(404, "NOT_FOUND", "Saved view not found.");
    return Response.json(
      { data: archived, status: "ARCHIVED" },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "The view could not be archived.");
  }
}

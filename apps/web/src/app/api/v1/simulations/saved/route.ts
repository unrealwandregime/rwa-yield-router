import { and, desc, eq, isNull } from "drizzle-orm";
import { routeSimulations } from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";

const updateSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120) }).strict();
const idSchema = z.object({ id: z.uuid() }).strict();

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request);
  if (!access.ok) return access.response;
  const rows = await access.value.database
    .select({
      createdAt: routeSimulations.createdAt,
      dataCutoff: routeSimulations.dataCutoff,
      grossBlendedApy: routeSimulations.grossBlendedApy,
      id: routeSimulations.id,
      methodologyVersionId: routeSimulations.methodologyVersionId,
      name: routeSimulations.name,
      netBlendedApy: routeSimulations.netBlendedApy,
      resultSummary: routeSimulations.resultSummary,
      status: routeSimulations.status,
      weightedRiskScore: routeSimulations.weightedRiskScore
    })
    .from(routeSimulations)
    .where(
      and(
        eq(routeSimulations.userId, access.value.authorization.userId),
        eq(routeSimulations.isSaved, true),
        isNull(routeSimulations.archivedAt)
      )
    )
    .orderBy(desc(routeSimulations.createdAt));
  return Response.json({ data: rows }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Saved simulation update is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const [updated] = await access.value.database
    .update(routeSimulations)
    .set({ name: parsed.data.name })
    .where(
      and(
        eq(routeSimulations.id, parsed.data.id),
        eq(routeSimulations.userId, access.value.authorization.userId),
        eq(routeSimulations.isSaved, true),
        isNull(routeSimulations.archivedAt)
      )
    )
    .returning({ id: routeSimulations.id });
  if (!updated) return apiError(404, "NOT_FOUND", "Saved simulation not found.");
  return Response.json(
    { data: updated, status: "UPDATED" },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  const parsed = idSchema.safeParse({ id: request.nextUrl.searchParams.get("id") });
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "A valid simulation id is required.",
      undefined,
      parsed.error.flatten()
    );
  const [archived] = await access.value.database
    .update(routeSimulations)
    .set({ archivedAt: new Date(), isSaved: false })
    .where(
      and(
        eq(routeSimulations.id, parsed.data.id),
        eq(routeSimulations.userId, access.value.authorization.userId),
        eq(routeSimulations.isSaved, true),
        isNull(routeSimulations.archivedAt)
      )
    )
    .returning({ id: routeSimulations.id });
  if (!archived) return apiError(404, "NOT_FOUND", "Saved simulation not found.");
  return Response.json({ status: "DELETED" }, { headers: { "cache-control": "no-store" } });
}

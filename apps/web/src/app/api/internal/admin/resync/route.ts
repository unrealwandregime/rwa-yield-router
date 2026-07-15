import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createIdempotencyKey, MORPHO_PRODUCTION_ROUTES } from "@rwa-yield-router/data-adapters";
import { adminAuditLogs, jobOutbox, productRoutes } from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";

const requestSchema = z
  .object({
    reason: z.string().trim().min(8).max(2_000),
    routeSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  })
  .strict();

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 20 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Re-sync request is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const identity = MORPHO_PRODUCTION_ROUTES.find(
    (candidate) => candidate.routeSlug === parsed.data.routeSlug
  );
  if (identity === undefined)
    return apiError(
      409,
      "CONFIGURATION_UNAVAILABLE",
      "This route has no canonical production adapter identity."
    );
  const [route] = await access.value.database
    .select({ id: productRoutes.id, version: productRoutes.version })
    .from(productRoutes)
    .where(
      and(
        eq(productRoutes.slug, parsed.data.routeSlug),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        isNull(productRoutes.effectiveTo)
      )
    )
    .limit(1);
  if (route === undefined) return apiError(404, "NOT_FOUND", "Published route not found.");

  const correlationId = randomUUID();
  const externalEntityId = `${identity.chainId}:${identity.contractAddress.toLowerCase()}`;
  const idempotencyKey = createIdempotencyKey("admin-resync", {
    correlationId,
    routeSlug: parsed.data.routeSlug
  });
  await access.value.database.transaction(async (transaction) => {
    await transaction.insert(jobOutbox).values({
      availableAt: new Date(),
      correlationId,
      idempotencyKey,
      payload: {
        correlationId,
        externalEntityId,
        idempotencyKey,
        name: "INGEST_SOURCE",
        sourceId: "MORPHO-API",
        version: 1
      },
      payloadVersion: "1",
      topic: "INGEST_SOURCE"
    });
    await transaction.insert(adminAuditLogs).values({
      action: "CATALOG_RESYNC_REQUEST",
      actorUserId: access.value.authorization.userId,
      afterValue: { externalEntityId, outboxIdempotencyKey: idempotencyKey },
      correlationId,
      occurredAt: new Date(),
      outcome: "APPROVED",
      reason: parsed.data.reason,
      targetId: route.id,
      targetRecordVersion: route.version,
      targetType: "PRODUCT_ROUTE"
    });
  });
  return Response.json(
    { data: { correlationId, routeSlug: parsed.data.routeSlug }, status: "QUEUED" },
    {
      headers: { "cache-control": "no-store", "x-correlation-id": correlationId },
      status: 202
    }
  );
}

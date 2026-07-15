import { randomUUID } from "node:crypto";
import { adminAuditLogs } from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";
import { createDataQualityCsv } from "@/lib/admin-contract";
import { getAdminSnapshot } from "@/lib/admin-service";

const requestSchema = z
  .object({
    reason: z.string().trim().min(8).max(2_000),
    report: z.literal("DATA_QUALITY")
  })
  .strict();

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 10 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "Export request is invalid.");
  try {
    const snapshot = await getAdminSnapshot(access.value.database);
    const csv = createDataQualityCsv(snapshot);
    const correlationId = randomUUID();
    await access.value.database.insert(adminAuditLogs).values({
      action: "DATA_QUALITY_EXPORT",
      actorUserId: access.value.authorization.userId,
      afterValue: {
        generatedAt: snapshot.generatedAt,
        report: parsed.data.report,
        routeCount: snapshot.catalog.length
      },
      correlationId,
      occurredAt: new Date(),
      outcome: "APPROVED",
      reason: parsed.data.reason,
      targetId: correlationId,
      targetRecordVersion: 1,
      targetType: "ADMIN_EXPORT",
      verificationDate: new Date(snapshot.generatedAt)
    });
    return new Response(csv, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="rwa-data-quality-${new Date().toISOString().slice(0, 10)}.csv"`,
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-correlation-id": correlationId
      }
    });
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Data-quality export is unavailable.");
  }
}

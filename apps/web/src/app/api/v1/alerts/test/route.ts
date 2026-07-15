import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  alertEvents,
  alertRuleDestinations,
  alertRules,
  notificationDeliveries,
  notificationDestinations
} from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";

const testRequestSchema = z.object({ ruleId: z.uuid() }).strict();

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 10 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = testRequestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "A valid rule id is required.",
      undefined,
      parsed.error.flatten()
    );

  const [target] = await access.value.database
    .select({
      channel: notificationDestinations.channel,
      destinationId: notificationDestinations.id
    })
    .from(alertRules)
    .innerJoin(alertRuleDestinations, eq(alertRules.id, alertRuleDestinations.alertRuleId))
    .innerJoin(
      notificationDestinations,
      eq(alertRuleDestinations.destinationId, notificationDestinations.id)
    )
    .where(
      and(
        eq(alertRules.id, parsed.data.ruleId),
        eq(alertRules.userId, access.value.authorization.userId),
        eq(notificationDestinations.userId, access.value.authorization.userId),
        isNull(alertRules.archivedAt),
        isNull(notificationDestinations.disabledAt)
      )
    )
    .limit(1);
  if (!target) return apiError(404, "NOT_FOUND", "Alert rule or active destination not found.");
  const now = new Date();
  const correlationId = randomUUID();
  await access.value.database.transaction(async (transaction) => {
    const [event] = await transaction
      .insert(alertEvents)
      .values({
        alertRuleId: parsed.data.ruleId,
        correlationId,
        deduplicationKey: `test:${parsed.data.ruleId}:${correlationId}`,
        evaluationVersion: "user-test-v1",
        payload: { informational: true, message: "Test notification", test: true },
        triggeredAt: now
      })
      .returning({ id: alertEvents.id });
    if (!event) throw new Error("Test alert event invariant failed");
    const inApp = target.channel === "IN_APP";
    await transaction.insert(notificationDeliveries).values({
      alertEventId: event.id,
      attemptCount: inApp ? 1 : 0,
      channel: target.channel,
      deliveredAt: inApp ? now : null,
      destinationId: target.destinationId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      lastAttemptAt: inApp ? now : null,
      status: inApp ? "DELIVERED" : "QUEUED"
    });
  });
  return Response.json(
    { status: target.channel === "IN_APP" ? "DELIVERED" : "QUEUED" },
    { headers: { "cache-control": "no-store" }, status: target.channel === "IN_APP" ? 200 : 202 }
  );
}

import { and, desc, eq } from "drizzle-orm";
import {
  alertEvents,
  alertRules,
  notificationDeliveries,
  notificationDestinations,
  productRoutes
} from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { authorizePrivateRequest } from "@/lib/authz";

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request, { rateLimit: 60 });
  if (!access.ok) return access.response;
  const rows = await access.value.database
    .select({
      attemptCount: notificationDeliveries.attemptCount,
      channel: notificationDeliveries.channel,
      condition: alertRules.condition,
      deliveryId: notificationDeliveries.id,
      destinationLabel: notificationDestinations.maskedLabel,
      errorCategory: notificationDeliveries.errorCategory,
      observedUnit: alertEvents.observedUnit,
      observedValue: alertEvents.observedValue,
      payload: alertEvents.payload,
      routeName: productRoutes.name,
      status: notificationDeliveries.status,
      triggeredAt: alertEvents.triggeredAt
    })
    .from(notificationDeliveries)
    .innerJoin(alertEvents, eq(notificationDeliveries.alertEventId, alertEvents.id))
    .innerJoin(alertRules, eq(alertEvents.alertRuleId, alertRules.id))
    .leftJoin(productRoutes, eq(alertRules.routeId, productRoutes.id))
    .innerJoin(
      notificationDestinations,
      eq(notificationDeliveries.destinationId, notificationDestinations.id)
    )
    .where(
      and(
        eq(alertRules.userId, access.value.authorization.userId),
        eq(notificationDestinations.userId, access.value.authorization.userId)
      )
    )
    .orderBy(desc(alertEvents.triggeredAt))
    .limit(50);
  return Response.json({ data: rows }, { headers: { "cache-control": "no-store" } });
}

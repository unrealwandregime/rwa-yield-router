import { and, desc, eq, isNull } from "drizzle-orm";
import {
  alertRuleDestinations,
  alertRules,
  notificationDestinations,
  productRoutes
} from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  ALERT_TRIGGER_DEFINITIONS,
  ALERT_TRIGGER_MAP,
  alertTriggerDefinition
} from "@/lib/alert-definitions";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";

const alertTriggers = ALERT_TRIGGER_DEFINITIONS.map((definition) => definition.trigger);

const alertRequestSchema = z
  .object({
    channel: z.enum(["IN_APP", "EMAIL", "TELEGRAM"]),
    cooldownMinutes: z.coerce.number().int().min(5).max(43_200),
    destinationId: z.uuid().nullable().optional(),
    lookbackHours: z.coerce.number().int().min(1).max(8_760).default(24),
    routeSlug: z.string().min(1).max(160),
    threshold: z.coerce.number().finite().nonnegative().nullable(),
    timezone: z.string().min(1).max(80),
    trigger: z.enum(alertTriggers)
  })
  .strict()
  .superRefine((value, context) => {
    const definition = alertTriggerDefinition(value.trigger);
    if (!("event" in definition) && value.threshold === null) {
      context.addIssue({
        code: "custom",
        message: "This alert condition requires a non-negative threshold.",
        path: ["threshold"]
      });
    }
    if (value.channel !== "IN_APP" && value.destinationId == null) {
      context.addIssue({
        code: "custom",
        message: "External alerts require an encrypted destination.",
        path: ["destinationId"]
      });
    }
  });

const alertUpdateSchema = z.object({ id: z.uuid(), enabled: z.boolean() }).strict();
const alertDeleteSchema = z.object({ id: z.uuid() }).strict();
const alertEvaluationSchema = z
  .object({
    evaluatedAt: z.iso.datetime({ offset: true }),
    reason: z.string().nullable(),
    status: z.enum(["CURRENT", "COOLDOWN", "TRIGGERED", "UNAVAILABLE"])
  })
  .strict();

const readLastEvaluation = (configuration: unknown) => {
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    return null;
  }
  const result = alertEvaluationSchema.safeParse(Reflect.get(configuration, "lastEvaluation"));
  return result.success ? result.data : null;
};

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request);
  if (!access.ok) return access.response;
  const rows = await access.value.database
    .select({
      condition: alertRules.condition,
      configuration: alertRules.configuration,
      cooldownSeconds: alertRules.cooldownSeconds,
      createdAt: alertRules.createdAt,
      enabled: alertRules.enabled,
      id: alertRules.id,
      channel: notificationDestinations.channel,
      destinationId: notificationDestinations.id,
      destinationLabel: notificationDestinations.maskedLabel,
      destinationVerifiedAt: notificationDestinations.verifiedAt,
      routeName: productRoutes.name,
      routeSlug: productRoutes.slug,
      threshold: alertRules.threshold,
      timezone: alertRules.timezone
    })
    .from(alertRules)
    .innerJoin(productRoutes, eq(alertRules.routeId, productRoutes.id))
    .innerJoin(alertRuleDestinations, eq(alertRules.id, alertRuleDestinations.alertRuleId))
    .innerJoin(
      notificationDestinations,
      eq(alertRuleDestinations.destinationId, notificationDestinations.id)
    )
    .where(
      and(
        eq(alertRules.userId, access.value.authorization.userId),
        eq(notificationDestinations.userId, access.value.authorization.userId),
        isNull(alertRules.archivedAt)
      )
    )
    .orderBy(desc(alertRules.createdAt));
  return Response.json(
    {
      data: rows.map(({ configuration, ...row }) => ({
        ...row,
        lastEvaluation: readLastEvaluation(configuration)
      }))
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = alertRequestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Alert rule is invalid.",
      undefined,
      parsed.error.flatten()
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone }).format();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Timezone must be a valid IANA identifier.");
  }
  const [route] = await access.value.database
    .select({ id: productRoutes.id })
    .from(productRoutes)
    .where(
      and(
        eq(productRoutes.slug, parsed.data.routeSlug),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        isNull(productRoutes.archivedAt)
      )
    )
    .limit(1);
  if (!route) return apiError(404, "NOT_FOUND", "Published route not found.");
  if (parsed.data.channel !== "IN_APP") {
    const destinationId = parsed.data.destinationId;
    if (destinationId == null) {
      return apiError(400, "VALIDATION_ERROR", "An external destination is required.");
    }
    const [configuredDestination] = await access.value.database
      .select({ id: notificationDestinations.id })
      .from(notificationDestinations)
      .where(
        and(
          eq(notificationDestinations.id, destinationId),
          eq(notificationDestinations.userId, access.value.authorization.userId),
          eq(notificationDestinations.channel, parsed.data.channel),
          isNull(notificationDestinations.disabledAt)
        )
      )
      .limit(1);
    if (configuredDestination === undefined) {
      return apiError(
        409,
        "CONFIGURATION_UNAVAILABLE",
        `${parsed.data.channel} delivery requires an active encrypted destination owned by this account.`
      );
    }
  }
  const created = await access.value.database.transaction(async (transaction) => {
    let [destination] = await transaction
      .select({ id: notificationDestinations.id })
      .from(notificationDestinations)
      .where(
        and(
          eq(notificationDestinations.userId, access.value.authorization.userId),
          eq(notificationDestinations.channel, parsed.data.channel),
          ...(parsed.data.destinationId == null
            ? []
            : [eq(notificationDestinations.id, parsed.data.destinationId)]),
          isNull(notificationDestinations.disabledAt)
        )
      )
      .limit(1);
    if (!destination && parsed.data.channel === "IN_APP") {
      [destination] = await transaction
        .insert(notificationDestinations)
        .values({
          channel: parsed.data.channel,
          maskedLabel:
            parsed.data.channel === "IN_APP"
              ? "In-app"
              : `${parsed.data.channel} destination pending verification`,
          userId: access.value.authorization.userId
        })
        .returning({ id: notificationDestinations.id });
    }
    if (!destination) throw new Error("NOTIFICATION_DESTINATION_UNAVAILABLE");
    const definition = alertTriggerDefinition(parsed.data.trigger);
    const threshold = "event" in definition ? null : String(parsed.data.threshold);
    const thresholdUnit = "event" in definition ? null : definition.unit;
    const [rule] = await transaction
      .insert(alertRules)
      .values({
        condition: ALERT_TRIGGER_MAP[parsed.data.trigger],
        configuration: {
          channel: parsed.data.channel,
          lookbackHours: parsed.data.lookbackHours
        },
        cooldownSeconds: parsed.data.cooldownMinutes * 60,
        routeId: route.id,
        threshold,
        thresholdUnit,
        timezone: parsed.data.timezone,
        userId: access.value.authorization.userId
      })
      .returning({ id: alertRules.id });
    if (!rule) throw new Error("Alert rule invariant failed");
    await transaction
      .insert(alertRuleDestinations)
      .values({ alertRuleId: rule.id, destinationId: destination.id });
    return rule;
  });
  return Response.json(
    { data: created, status: "CREATED" },
    { headers: { "cache-control": "no-store" }, status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = alertUpdateSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Alert update is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const [updated] = await access.value.database
    .update(alertRules)
    .set({
      enabled: parsed.data.enabled,
      updatedAt: new Date(),
      ...(parsed.data.enabled ? { unsubscribedAt: null } : {})
    })
    .where(
      and(
        eq(alertRules.id, parsed.data.id),
        eq(alertRules.userId, access.value.authorization.userId),
        isNull(alertRules.archivedAt)
      )
    )
    .returning({ id: alertRules.id });
  if (!updated) return apiError(404, "NOT_FOUND", "Alert rule not found.");
  return Response.json(
    { data: updated, status: "UPDATED" },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  const parsed = alertDeleteSchema.safeParse({ id: request.nextUrl.searchParams.get("id") });
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "A valid alert id is required.",
      undefined,
      parsed.error.flatten()
    );
  const now = new Date();
  const [archived] = await access.value.database
    .update(alertRules)
    .set({ archivedAt: now, enabled: false, unsubscribedAt: now, updatedAt: now })
    .where(
      and(
        eq(alertRules.id, parsed.data.id),
        eq(alertRules.userId, access.value.authorization.userId),
        isNull(alertRules.archivedAt)
      )
    )
    .returning({ id: alertRules.id });
  if (!archived) return apiError(404, "NOT_FOUND", "Alert rule not found.");
  return Response.json({ status: "DELETED" }, { headers: { "cache-control": "no-store" } });
}

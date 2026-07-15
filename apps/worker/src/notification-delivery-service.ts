import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  alertEvents,
  alertRules,
  notificationDeliveries,
  notificationDestinations,
  productRoutes,
  type Database
} from "@rwa-yield-router/database";
import {
  decryptNotificationDestination,
  type NotificationDeliveryResult,
  type NotificationDispatcher
} from "@rwa-yield-router/notifications";

export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 4;
const DELIVERY_BATCH_SIZE = 50;

const isTestPayload = (payload: unknown): boolean =>
  typeof payload === "object" && payload !== null && "test" in payload && payload.test === true;

export const notificationRetryDelaySeconds = (deliveryId: string, attempt: number): number => {
  const digest = createHash("sha256").update(deliveryId).digest();
  const jitter = (digest[0] ?? 0) % 30;
  return Math.min(3_600, 60 * 2 ** Math.max(0, attempt - 1) + jitter);
};

const hashProviderMessageId = (providerMessageId: string): string =>
  createHash("sha256").update(providerMessageId).digest("hex");

export interface NotificationDeliveryServiceOptions {
  readonly database: Database;
  readonly dispatcher: NotificationDispatcher;
  readonly encryptionKey?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export type NotificationDeliveryOutcome =
  "DELIVERED" | "RETRY_SCHEDULED" | "FAILED" | "SUPPRESSED" | "SKIPPED";

export async function deliverNotificationById(
  options: NotificationDeliveryServiceOptions,
  deliveryId: string
): Promise<NotificationDeliveryOutcome> {
  const attemptedAt = (options.now ?? (() => new Date()))();
  const [candidate] = await options.database
    .select({
      alertEventId: notificationDeliveries.alertEventId,
      attemptCount: notificationDeliveries.attemptCount,
      channel: notificationDeliveries.channel,
      condition: alertRules.condition,
      correlationId: alertEvents.correlationId,
      destinationCiphertext: notificationDestinations.destinationCiphertext,
      destinationDisabledAt: notificationDestinations.disabledAt,
      destinationId: notificationDestinations.id,
      destinationVerifiedAt: notificationDestinations.verifiedAt,
      eventPayload: alertEvents.payload,
      expiresAt: notificationDeliveries.expiresAt,
      id: notificationDeliveries.id,
      observedUnit: alertEvents.observedUnit,
      observedValue: alertEvents.observedValue,
      routeName: productRoutes.name,
      status: notificationDeliveries.status,
      threshold: alertRules.threshold,
      thresholdUnit: alertRules.thresholdUnit
    })
    .from(notificationDeliveries)
    .innerJoin(alertEvents, eq(notificationDeliveries.alertEventId, alertEvents.id))
    .innerJoin(alertRules, eq(alertEvents.alertRuleId, alertRules.id))
    .innerJoin(
      notificationDestinations,
      eq(notificationDeliveries.destinationId, notificationDestinations.id)
    )
    .leftJoin(productRoutes, eq(alertRules.routeId, productRoutes.id))
    .where(eq(notificationDeliveries.id, deliveryId))
    .limit(1);
  if (
    candidate === undefined ||
    (candidate.status !== "QUEUED" && candidate.status !== "RETRYABLE_FAILURE")
  ) {
    return "SKIPPED";
  }
  if (candidate.expiresAt.getTime() <= attemptedAt.getTime()) {
    await options.database
      .update(notificationDeliveries)
      .set({ errorCategory: "DELIVERY_EXPIRED", status: "CANCELLED", updatedAt: attemptedAt })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "SUPPRESSED";
  }

  const nextAttempt = candidate.attemptCount + 1;
  const [claimed] = await options.database
    .update(notificationDeliveries)
    .set({
      attemptCount: nextAttempt,
      errorCategory: null,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      status: "ATTEMPTING",
      updatedAt: attemptedAt
    })
    .where(
      and(
        eq(notificationDeliveries.id, candidate.id),
        inArray(notificationDeliveries.status, ["QUEUED", "RETRYABLE_FAILURE"])
      )
    )
    .returning({ id: notificationDeliveries.id });
  if (claimed === undefined) return "SKIPPED";

  if (candidate.destinationDisabledAt !== null) {
    await options.database
      .update(notificationDeliveries)
      .set({ errorCategory: "DESTINATION_DISABLED", status: "CANCELLED", updatedAt: attemptedAt })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "SUPPRESSED";
  }
  if (candidate.channel !== "EMAIL" && candidate.channel !== "TELEGRAM") {
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: "CHANNEL_NOT_EXTERNAL",
        status: "PERMANENT_FAILURE",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "FAILED";
  }
  const isTest = isTestPayload(candidate.eventPayload);
  if (!isTest && candidate.destinationVerifiedAt === null) {
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: "DESTINATION_NOT_TESTED",
        status: "SUPPRESSED",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "SUPPRESSED";
  }
  if (options.encryptionKey === undefined || candidate.destinationCiphertext === null) {
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: "DESTINATION_DECRYPTION_NOT_CONFIGURED",
        status: "SUPPRESSED",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "SUPPRESSED";
  }

  let destination: string;
  try {
    destination = decryptNotificationDestination(
      candidate.channel,
      candidate.destinationCiphertext,
      options.encryptionKey
    );
  } catch {
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: "DESTINATION_DECRYPTION_FAILED",
        status: "PERMANENT_FAILURE",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "FAILED";
  }

  const label = candidate.routeName ?? "portfolio route";
  const observed =
    candidate.observedValue === null
      ? "A sourced event was recorded."
      : `Observed ${candidate.observedValue} ${candidate.observedUnit ?? ""}.`;
  const threshold =
    candidate.threshold === null
      ? ""
      : ` Configured threshold: ${candidate.threshold} ${candidate.thresholdUnit ?? ""}.`;
  let result: NotificationDeliveryResult;
  try {
    result = await options.dispatcher.deliver({
      channel: candidate.channel,
      correlationId: candidate.correlationId,
      deliveryId: candidate.id,
      destination,
      eventId: candidate.alertEventId,
      subject: isTest
        ? "RWA Yield Router test notification"
        : `RWA Yield Router: ${candidate.condition}`,
      text: `${label}: ${observed}${threshold} Informational only; not investment advice.`
    });
  } catch {
    if (nextAttempt < MAX_NOTIFICATION_DELIVERY_ATTEMPTS) {
      await options.database
        .update(notificationDeliveries)
        .set({
          errorCategory: "NOTIFICATION_ADAPTER_FAILURE",
          nextAttemptAt: new Date(
            attemptedAt.getTime() + notificationRetryDelaySeconds(candidate.id, nextAttempt) * 1_000
          ),
          status: "RETRYABLE_FAILURE",
          updatedAt: attemptedAt
        })
        .where(eq(notificationDeliveries.id, candidate.id));
      return "RETRY_SCHEDULED";
    }
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: "NOTIFICATION_ADAPTER_FAILURE_RETRY_LIMIT",
        status: "PERMANENT_FAILURE",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "FAILED";
  }

  if (result.status === "DELIVERED") {
    const deliveredAt = new Date(result.deliveredAt);
    await options.database.transaction(async (transaction) => {
      await transaction
        .update(notificationDeliveries)
        .set({
          deliveredAt,
          errorCategory: null,
          providerMessageIdHash:
            result.providerMessageId === null
              ? null
              : hashProviderMessageId(result.providerMessageId),
          status: "DELIVERED",
          updatedAt: deliveredAt
        })
        .where(eq(notificationDeliveries.id, candidate.id));
      if (isTest && candidate.destinationVerifiedAt === null) {
        await transaction
          .update(notificationDestinations)
          .set({ updatedAt: deliveredAt, verifiedAt: deliveredAt })
          .where(eq(notificationDestinations.id, candidate.destinationId));
      }
    });
    return "DELIVERED";
  }

  if (result.status === "RETRYABLE_FAILURE" && nextAttempt < MAX_NOTIFICATION_DELIVERY_ATTEMPTS) {
    const providerDelay = result.retryAfterSeconds;
    const delaySeconds = providerDelay ?? notificationRetryDelaySeconds(candidate.id, nextAttempt);
    await options.database
      .update(notificationDeliveries)
      .set({
        errorCategory: result.code,
        nextAttemptAt: new Date(attemptedAt.getTime() + delaySeconds * 1_000),
        status: "RETRYABLE_FAILURE",
        updatedAt: attemptedAt
      })
      .where(eq(notificationDeliveries.id, candidate.id));
    return "RETRY_SCHEDULED";
  }

  const errorCategory =
    result.status === "RETRYABLE_FAILURE" ? `${result.code}_RETRY_LIMIT` : result.code;
  await options.database
    .update(notificationDeliveries)
    .set({
      errorCategory,
      status: result.status === "SUPPRESSED" ? "SUPPRESSED" : "PERMANENT_FAILURE",
      updatedAt: attemptedAt
    })
    .where(eq(notificationDeliveries.id, candidate.id));
  return result.status === "SUPPRESSED" ? "SUPPRESSED" : "FAILED";
}

export async function deliverDueNotifications(
  options: NotificationDeliveryServiceOptions
): Promise<Readonly<{ attempted: number; delivered: number; failed: number }>> {
  const currentTime = (options.now ?? (() => new Date()))();
  await options.database
    .update(notificationDeliveries)
    .set({
      errorCategory: "ATTEMPT_INTERRUPTED",
      nextAttemptAt: currentTime,
      status: "RETRYABLE_FAILURE",
      updatedAt: currentTime
    })
    .where(
      and(
        eq(notificationDeliveries.status, "ATTEMPTING"),
        lt(notificationDeliveries.lastAttemptAt, new Date(currentTime.getTime() - 15 * 60_000))
      )
    );
  await options.database
    .update(notificationDeliveries)
    .set({ errorCategory: "DELIVERY_EXPIRED", status: "CANCELLED", updatedAt: currentTime })
    .where(
      and(
        inArray(notificationDeliveries.status, ["QUEUED", "RETRYABLE_FAILURE"]),
        lte(notificationDeliveries.expiresAt, currentTime)
      )
    );
  const due = await options.database
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.status, ["QUEUED", "RETRYABLE_FAILURE"]),
        gt(notificationDeliveries.expiresAt, currentTime),
        or(
          isNull(notificationDeliveries.nextAttemptAt),
          lte(notificationDeliveries.nextAttemptAt, currentTime)
        )
      )
    )
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(DELIVERY_BATCH_SIZE);
  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    const outcome = await deliverNotificationById(options, row.id);
    if (outcome === "DELIVERED") delivered += 1;
    if (outcome === "FAILED") failed += 1;
  }
  return { attempted: due.length, delivered, failed };
}

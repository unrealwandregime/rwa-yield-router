import { and, desc, eq, inArray } from "drizzle-orm";
import { getServerConfig } from "@rwa-yield-router/config";
import { notificationDeliveries, notificationDestinations } from "@rwa-yield-router/database";
import {
  encryptNotificationDestination,
  externalNotificationChannelSchema,
  hashNotificationDestination,
  maskNotificationDestination,
  normalizeNotificationDestination
} from "@rwa-yield-router/notifications";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";

const createDestinationSchema = z
  .object({
    channel: externalNotificationChannelSchema,
    destination: z.string().trim().min(1).max(512)
  })
  .strict();

const destinationIdSchema = z.uuid();

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request);
  if (!access.ok) return access.response;

  const rows = await access.value.database
    .select({
      channel: notificationDestinations.channel,
      createdAt: notificationDestinations.createdAt,
      disabledAt: notificationDestinations.disabledAt,
      id: notificationDestinations.id,
      maskedLabel: notificationDestinations.maskedLabel,
      verifiedAt: notificationDestinations.verifiedAt
    })
    .from(notificationDestinations)
    .where(eq(notificationDestinations.userId, access.value.authorization.userId))
    .orderBy(desc(notificationDestinations.createdAt));

  return Response.json({ data: rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 10 });
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = createDestinationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Notification destination is invalid.",
      undefined,
      parsed.error.flatten()
    );
  }

  const key = getServerConfig().dataEncryptionKey;
  if (key === undefined) {
    return apiError(
      503,
      "CONFIGURATION_UNAVAILABLE",
      "Encrypted external notification destinations are not configured."
    );
  }

  try {
    const destination = normalizeNotificationDestination(
      parsed.data.channel,
      parsed.data.destination
    );
    const destinationHash = hashNotificationDestination(parsed.data.channel, destination, key);
    const destinationCiphertext = encryptNotificationDestination(
      parsed.data.channel,
      destination,
      key
    );
    const [stored] = await access.value.database
      .insert(notificationDestinations)
      .values({
        channel: parsed.data.channel,
        destinationCiphertext,
        destinationHash,
        maskedLabel: maskNotificationDestination(parsed.data.channel, destination),
        userId: access.value.authorization.userId
      })
      .onConflictDoUpdate({
        target: [
          notificationDestinations.userId,
          notificationDestinations.channel,
          notificationDestinations.destinationHash
        ],
        set: {
          destinationCiphertext,
          disabledAt: null,
          maskedLabel: maskNotificationDestination(parsed.data.channel, destination),
          updatedAt: new Date()
        }
      })
      .returning({
        channel: notificationDestinations.channel,
        disabledAt: notificationDestinations.disabledAt,
        id: notificationDestinations.id,
        maskedLabel: notificationDestinations.maskedLabel,
        verifiedAt: notificationDestinations.verifiedAt
      });
    if (stored === undefined) throw new Error("DESTINATION_STORAGE_INVARIANT");
    return Response.json(
      { data: stored, status: "CREATED" },
      { headers: { "cache-control": "no-store" }, status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        parsed.data.channel === "EMAIL"
          ? "Enter a valid email address."
          : "Enter the numeric Telegram chat identifier provided by the configured bot."
      );
    }
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Destination could not be stored safely.");
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeMutation(request, { rateLimit: 10 });
  if (!access.ok) return access.response;
  const parsed = destinationIdSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "A valid destination id is required.");
  }

  const now = new Date();
  const disabled = await access.value.database.transaction(async (transaction) => {
    const [destination] = await transaction
      .update(notificationDestinations)
      .set({ disabledAt: now, updatedAt: now })
      .where(
        and(
          eq(notificationDestinations.id, parsed.data),
          eq(notificationDestinations.userId, access.value.authorization.userId)
        )
      )
      .returning({ id: notificationDestinations.id });
    if (destination === undefined) return undefined;
    await transaction
      .update(notificationDeliveries)
      .set({ errorCategory: "DESTINATION_DISABLED", status: "CANCELLED", updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.destinationId, destination.id),
          inArray(notificationDeliveries.status, ["QUEUED", "RETRYABLE_FAILURE"])
        )
      );
    return destination;
  });

  if (disabled === undefined) return apiError(404, "NOT_FOUND", "Destination not found.");
  return Response.json({ status: "DISABLED" }, { headers: { "cache-control": "no-store" } });
}

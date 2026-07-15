import { z } from "zod";

export const notificationChannelSchema = z.enum(["EMAIL", "TELEGRAM", "IN_APP"]);
export const notificationMessageSchema = z
  .object({
    deliveryId: z.uuid(),
    eventId: z.uuid(),
    channel: notificationChannelSchema,
    destination: z.string().trim().min(1).max(512),
    subject: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(8_000),
    correlationId: z.string().trim().min(1).max(128)
  })
  .strict();

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export type NotificationDeliveryResult =
  | Readonly<{
      status: "DELIVERED";
      providerMessageId: string | null;
      deliveredAt: string;
    }>
  | Readonly<{
      status: "RETRYABLE_FAILURE";
      code: string;
      retryAfterSeconds: number | null;
    }>
  | Readonly<{
      status: "PERMANENT_FAILURE";
      code: string;
    }>
  | Readonly<{
      status: "SUPPRESSED";
      code: string;
    }>;

export interface NotificationAdapter {
  readonly channel: NotificationChannel;
  deliver(message: NotificationMessage): Promise<NotificationDeliveryResult>;
  healthCheck(): Promise<Readonly<{ healthy: true }> | Readonly<{ healthy: false; code: string }>>;
}

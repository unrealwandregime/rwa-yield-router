import {
  notificationMessageSchema,
  type NotificationAdapter,
  type NotificationDeliveryResult,
  type NotificationMessage
} from "./types.js";

export interface InAppNotificationStore {
  persist(
    message: NotificationMessage
  ): Promise<Readonly<{ created: true; notificationId: string }> | Readonly<{ created: false }>>;
  healthCheck(): Promise<boolean>;
}

export class InAppNotificationAdapter implements NotificationAdapter {
  public readonly channel = "IN_APP" as const;

  public constructor(private readonly store: InAppNotificationStore) {}

  public async deliver(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const parsed = notificationMessageSchema.parse(message);
    try {
      const result = await this.store.persist(parsed);
      return {
        deliveredAt: new Date().toISOString(),
        providerMessageId: result.created ? result.notificationId : parsed.deliveryId,
        status: "DELIVERED"
      };
    } catch {
      return {
        code: "IN_APP_STORE_UNAVAILABLE",
        retryAfterSeconds: null,
        status: "RETRYABLE_FAILURE"
      };
    }
  }

  public async healthCheck(): Promise<
    Readonly<{ healthy: true }> | Readonly<{ healthy: false; code: string }>
  > {
    return (await this.store.healthCheck())
      ? { healthy: true }
      : { code: "IN_APP_STORE_UNAVAILABLE", healthy: false };
  }
}

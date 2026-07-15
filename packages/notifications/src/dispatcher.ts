import type {
  NotificationAdapter,
  NotificationChannel,
  NotificationDeliveryResult,
  NotificationMessage
} from "./types.js";

export class NotificationDispatcher {
  private readonly adapters: ReadonlyMap<NotificationChannel, NotificationAdapter>;

  public constructor(adapters: ReadonlyArray<NotificationAdapter>) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.channel, adapter]));
  }

  public async deliver(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const adapter = this.adapters.get(message.channel);
    if (adapter === undefined) {
      return { code: "CHANNEL_NOT_CONFIGURED", status: "SUPPRESSED" };
    }
    return adapter.deliver(message);
  }

  public async fanOut(
    messages: ReadonlyArray<NotificationMessage>
  ): Promise<
    ReadonlyArray<Readonly<{ message: NotificationMessage; result: NotificationDeliveryResult }>>
  > {
    return Promise.all(
      messages.map(async (message) => ({
        message,
        result: await this.deliver(message)
      }))
    );
  }
}

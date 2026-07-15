import { z } from "zod";

import { postJson } from "./http.js";
import {
  notificationMessageSchema,
  type NotificationAdapter,
  type NotificationDeliveryResult,
  type NotificationMessage
} from "./types.js";

const telegramResponseSchema = z
  .object({
    ok: z.literal(true),
    result: z.object({ message_id: z.number().int().nonnegative() }).passthrough()
  })
  .passthrough();

export interface TelegramAdapterOptions {
  readonly botToken?: string | undefined;
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
}

export class TelegramAdapter implements NotificationAdapter {
  public readonly channel = "TELEGRAM" as const;

  public constructor(private readonly options: TelegramAdapterOptions) {}

  public async deliver(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const parsed = notificationMessageSchema.parse(message);
    if (this.options.botToken === undefined) {
      return { code: "CHANNEL_DISABLED", status: "SUPPRESSED" };
    }
    const result = await postJson({
      body: {
        chat_id: parsed.destination,
        disable_web_page_preview: true,
        text: parsed.subject + "\n\n" + parsed.text
      },
      fetchImplementation: this.options.fetchImplementation,
      headers: { "Content-Type": "application/json" },
      url: "https://api.telegram.org/bot" + this.options.botToken + "/sendMessage"
    });
    if (!result.ok) {
      return result.retryable
        ? {
            code: result.code,
            retryAfterSeconds: result.retryAfterSeconds,
            status: "RETRYABLE_FAILURE"
          }
        : { code: result.code, status: "PERMANENT_FAILURE" };
    }
    const body = telegramResponseSchema.safeParse(result.body);
    if (!body.success) {
      return {
        code: "MALFORMED_PROVIDER_RESPONSE",
        retryAfterSeconds: null,
        status: "RETRYABLE_FAILURE"
      };
    }
    return {
      deliveredAt: (this.options.now ?? (() => new Date()))().toISOString(),
      providerMessageId: String(body.data.result.message_id),
      status: "DELIVERED"
    };
  }

  public async healthCheck(): Promise<
    Readonly<{ healthy: true }> | Readonly<{ healthy: false; code: string }>
  > {
    return this.options.botToken === undefined
      ? { code: "CHANNEL_DISABLED", healthy: false }
      : { healthy: true };
  }
}

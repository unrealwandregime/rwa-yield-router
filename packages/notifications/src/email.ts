import { z } from "zod";

import type { Logger } from "@rwa-yield-router/observability";

import { postJson } from "./http.js";
import {
  notificationMessageSchema,
  type NotificationAdapter,
  type NotificationDeliveryResult,
  type NotificationMessage
} from "./types.js";

const resendResponseSchema = z.object({ id: z.string().min(1) }).passthrough();

export class ConsoleEmailAdapter implements NotificationAdapter {
  public readonly channel = "EMAIL" as const;

  public constructor(private readonly logger: Logger) {}

  public async deliver(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const parsed = notificationMessageSchema.parse(message);
    this.logger.info("notification.console_email", {
      correlationId: parsed.correlationId,
      deliveryId: parsed.deliveryId,
      eventId: parsed.eventId,
      subjectLength: parsed.subject.length,
      textLength: parsed.text.length
    });
    return {
      deliveredAt: new Date().toISOString(),
      providerMessageId: null,
      status: "DELIVERED"
    };
  }

  public async healthCheck(): Promise<Readonly<{ healthy: true }>> {
    return { healthy: true };
  }
}

export interface ResendEmailAdapterOptions {
  readonly apiKey?: string | undefined;
  readonly from: string;
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
}

export class ResendEmailAdapter implements NotificationAdapter {
  public readonly channel = "EMAIL" as const;

  public constructor(private readonly options: ResendEmailAdapterOptions) {}

  public async deliver(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const parsed = notificationMessageSchema.parse(message);
    if (this.options.apiKey === undefined) {
      return { code: "CHANNEL_DISABLED", status: "SUPPRESSED" };
    }
    const result = await postJson({
      body: {
        from: this.options.from,
        to: [parsed.destination],
        subject: parsed.subject,
        text: parsed.text
      },
      fetchImplementation: this.options.fetchImplementation,
      headers: {
        Authorization: "Bearer " + this.options.apiKey,
        "Content-Type": "application/json"
      },
      url: "https://api.resend.com/emails"
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
    const body = resendResponseSchema.safeParse(result.body);
    if (!body.success) {
      return {
        code: "MALFORMED_PROVIDER_RESPONSE",
        retryAfterSeconds: null,
        status: "RETRYABLE_FAILURE"
      };
    }
    return {
      deliveredAt: (this.options.now ?? (() => new Date()))().toISOString(),
      providerMessageId: body.data.id,
      status: "DELIVERED"
    };
  }

  public async healthCheck(): Promise<
    Readonly<{ healthy: true }> | Readonly<{ healthy: false; code: string }>
  > {
    return this.options.apiKey === undefined
      ? { code: "CHANNEL_DISABLED", healthy: false }
      : { healthy: true };
  }
}

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { TelegramAdapter } from "./telegram.js";
import type { NotificationMessage } from "./types.js";

function telegramMessage(): NotificationMessage {
  return {
    channel: "TELEGRAM",
    correlationId: "correlation-test",
    deliveryId: randomUUID(),
    destination: "1234",
    eventId: randomUUID(),
    subject: "Yield alert",
    text: "A sourced metric crossed your configured threshold."
  };
}

describe("TelegramAdapter", () => {
  it("suppresses delivery when no credential is configured", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const adapter = new TelegramAdapter({ fetchImplementation });

    await expect(adapter.deliver(telegramMessage())).resolves.toEqual({
      code: "CHANNEL_DISABLED",
      status: "SUPPRESSED"
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("classifies rate limits as retryable without exposing the token", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), {
        headers: {
          "content-type": "application/json",
          "retry-after": "30"
        },
        status: 429
      })
    );
    const adapter = new TelegramAdapter({
      botToken: "test-token-that-is-long-enough",
      fetchImplementation
    });

    await expect(adapter.deliver(telegramMessage())).resolves.toEqual({
      code: "PROVIDER_REJECTED",
      retryAfterSeconds: 30,
      status: "RETRYABLE_FAILURE"
    });
  });

  it("accepts a protocol-faithful success response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );
    const adapter = new TelegramAdapter({
      botToken: "test-token-that-is-long-enough",
      fetchImplementation,
      now: () => new Date("2026-07-13T00:00:00.000Z")
    });

    await expect(adapter.deliver(telegramMessage())).resolves.toEqual({
      deliveredAt: "2026-07-13T00:00:00.000Z",
      providerMessageId: "9",
      status: "DELIVERED"
    });
  });
});

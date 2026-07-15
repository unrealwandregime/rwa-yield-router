import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebVitalLogRecord, POST } from "./route";

const token = "A".repeat(43);

function request(body: unknown, overrides: Readonly<Record<string, string>> = {}) {
  return new NextRequest("http://router.example/api/v1/web-vitals", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: `rwa-csrf=${token}`,
      origin: "http://router.example",
      "sec-fetch-site": "same-origin",
      "x-real-ip": crypto.randomUUID(),
      "x-rwa-csrf-token": token,
      ...overrides
    },
    method: "POST"
  });
}

afterEach(() => vi.restoreAllMocks());

describe("web-vitals endpoint", () => {
  it("accepts validated same-origin metrics and logs only the canonical payload", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const response = await POST(
      request({
        delta: 10,
        name: "INP",
        navigationType: "navigate",
        rating: "good",
        value: 120
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    const record = JSON.parse(lines[0] ?? "{}") as Readonly<Record<string, unknown>>;
    expect(record.event).toBe("web_vital.observed");
    expect(record.metric).toEqual({
      delta: 10,
      name: "INP",
      navigationType: "navigate",
      rating: "good",
      value: 120
    });
    expect(JSON.stringify(record)).not.toContain("x-real-ip");
  });

  it("rejects cross-origin and malformed metrics", async () => {
    const crossOrigin = await POST(
      request(
        {
          delta: 10,
          name: "INP",
          navigationType: "navigate",
          rating: "good",
          value: 120
        },
        { origin: "http://attacker.invalid", "sec-fetch-site": "cross-site" }
      )
    );
    expect(crossOrigin.status).toBe(403);

    const malformed = await POST(
      request({
        delta: 1,
        name: "CUSTOM",
        navigationType: "navigate",
        rating: "good",
        value: 1
      })
    );
    expect(malformed.status).toBe(400);
  });

  it("creates a deterministic structured record without request metadata", () => {
    expect(
      createWebVitalLogRecord(
        {
          delta: 4,
          name: "LCP",
          navigationType: "reload",
          rating: "needs-improvement",
          value: 2500
        },
        "correlation-id",
        new Date("2026-07-14T00:00:00.000Z")
      )
    ).toMatchObject({
      correlationId: "correlation-id",
      event: "web_vital.observed",
      metric: {
        delta: 4,
        name: "LCP",
        navigationType: "reload",
        rating: "needs-improvement",
        value: 2500
      },
      timestamp: "2026-07-14T00:00:00.000Z"
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  decodeCursor,
  encodeCursor,
  readBoundedJson,
  requestIdentity,
  validateBrowserMutation,
  validateCsrfToken,
  validateOrigin,
  type JsonBodyError
} from "@/lib/api";

describe("public API controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses opaque bounded cursors", () => expect(decodeCursor(encodeCursor(42))).toBe(42));
  it("rejects cross-origin mutations", () => {
    const headers = new Headers({ origin: "https://attacker.invalid" });
    expect(validateOrigin("https://router.example/api/v1/settings", headers)).toBe(false);
    expect(validateOrigin("https://router.example/api/v1/settings", new Headers())).toBe(false);
  });
  it("accepts only an explicit same-origin browser context", () => {
    const originHeaders = new Headers({
      origin: "https://router.example",
      "sec-fetch-site": "same-origin"
    });
    const refererHeaders = new Headers({ referer: "https://router.example/settings" });
    expect(validateOrigin("https://router.example/api/v1/settings", originHeaders)).toBe(true);
    expect(validateOrigin("https://router.example/api/v1/settings", refererHeaders)).toBe(true);
  });
  it("treats loopback dev hostnames as equivalent on the same scheme and port", () => {
    const headers = new Headers({ referer: "http://127.0.0.1:3003/simulator" });
    expect(validateOrigin("http://localhost:3003/api/v1/simulations", headers)).toBe(true);
    expect(validateOrigin("http://localhost:3004/api/v1/simulations", headers)).toBe(false);
  });
  it("requires an exact double-submit token for browser mutations", () => {
    const token = "A".repeat(43);
    const headers = new Headers({
      cookie: `__Host-rwa-csrf=${token}`,
      origin: "https://router.example",
      "sec-fetch-site": "same-origin",
      "x-rwa-csrf-token": token
    });
    expect(validateCsrfToken("https://router.example/api/v1/settings", headers)).toBe(true);
    expect(validateBrowserMutation("https://router.example/api/v1/settings", headers)).toBe(true);
    headers.set("x-rwa-csrf-token", "B".repeat(43));
    expect(validateCsrfToken("https://router.example/api/v1/settings", headers)).toBe(false);
    headers.delete("x-rwa-csrf-token");
    expect(validateCsrfToken("https://router.example/api/v1/settings", headers)).toBe(false);
  });
  it("uses the trusted public origin behind an internal HTTP reverse proxy", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    const token = "A".repeat(43);
    const headers = new Headers({
      cookie: `__Host-rwa-csrf=${token}`,
      origin: "https://router.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "attacker.invalid",
      "x-forwarded-proto": "http",
      "x-rwa-csrf-token": token
    });
    const internalUrl = "http://render-internal:10000/api/v1/simulations";

    expect(validateBrowserMutation(internalUrl, headers)).toBe(true);
    headers.set("origin", "https://attacker.invalid");
    headers.set("x-forwarded-host", "router.example");
    headers.set("x-forwarded-proto", "https");
    expect(validateBrowserMutation(internalUrl, headers)).toBe(false);
  });
  it("keeps local standalone mutation checks bound to the loopback origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    const token = "A".repeat(43);
    const headers = new Headers({
      cookie: `rwa-csrf=${token}`,
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      "x-rwa-csrf-token": token
    });

    expect(validateBrowserMutation("http://127.0.0.1:3000/api/v1/simulations", headers)).toBe(true);
    headers.set("origin", "https://router.example");
    expect(validateBrowserMutation("http://127.0.0.1:3000/api/v1/simulations", headers)).toBe(
      false
    );
  });
  it("bounds repeated callers", async () => {
    const key = `test-${crypto.randomUUID()}`;
    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(false);
  });
  it("allows preview to fall back to bounded in-memory rate limits without Redis", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_TIER", "preview");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    vi.stubEnv("REDIS_URL", "");
    const key = `preview-${crypto.randomUUID()}`;

    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(false);
  });
  it("fails closed for true production when Redis is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_TIER", "production");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    vi.stubEnv("REDIS_URL", "");

    expect((await checkRateLimit(`production-${crypto.randomUUID()}`, 600, 60_000)).allowed).toBe(
      false
    );
  });
  it("uses only the configured Render forwarding boundary for rate-limit identity", () => {
    vi.stubEnv("TRUSTED_PROXY_MODE", "render");
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.99",
      "x-forwarded-for": "198.51.100.23, 192.0.2.10",
      "x-real-ip": "203.0.113.98"
    });
    const identity = requestIdentity(headers);
    headers.set("cf-connecting-ip", "192.0.2.200");
    headers.set("x-real-ip", "192.0.2.201");
    expect(requestIdentity(headers)).toBe(identity);

    headers.set("x-forwarded-for", "attacker-controlled, 198.51.100.23");
    const invalidIdentity = requestIdentity(headers);
    headers.delete("x-forwarded-for");
    expect(requestIdentity(headers)).toBe(invalidIdentity);
  });
  it("does not trust forwarding headers without an explicit proxy mode", () => {
    vi.stubEnv("TRUSTED_PROXY_MODE", "none");
    const spoofed = requestIdentity(new Headers({ "x-forwarded-for": "198.51.100.23" }));
    expect(spoofed).toBe(requestIdentity(new Headers()));
  });
  it("rejects chunked JSON bodies as soon as they exceed the application limit", async () => {
    const encoder = new TextEncoder();
    const chunks: Uint8Array<ArrayBuffer>[] = [
      new Uint8Array(encoder.encode('{"value":"')),
      new Uint8Array(encoder.encode("x".repeat(32)))
    ];
    let cancelled = false;
    const request = {
      body: new ReadableStream<Uint8Array<ArrayBuffer>>({
        cancel: () => {
          cancelled = true;
        },
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk === undefined) controller.close();
          else controller.enqueue(chunk);
        }
      }),
      headers: new Headers({ "content-type": "application/json" })
    };

    await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413
    } satisfies Partial<JsonBodyError>);
    expect(cancelled).toBe(true);
  });
  it("requires JSON content type before reading the body", async () => {
    await expect(
      readBoundedJson(
        {
          body: new Response("{}").body,
          headers: new Headers({ "content-type": "text/plain" })
        },
        16
      )
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE", status: 415 });
  });
});

import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  decodeCursor,
  encodeCursor,
  validateBrowserMutation,
  validateCsrfToken,
  validateOrigin
} from "@/lib/api";

describe("public API controls", () => {
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
  it("bounds repeated callers", async () => {
    const key = `test-${crypto.randomUUID()}`;
    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 60_000)).allowed).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { normalizeWebVital } from "@/lib/web-vitals";

describe("web-vitals normalization", () => {
  it("keeps only bounded non-identifying metric fields", () => {
    expect(
      normalizeWebVital({
        attribution: { element: "#account-user-123" },
        delta: 12.5,
        id: "sensitive-session-like-id",
        name: "LCP",
        navigationType: "navigate",
        rating: "good",
        value: 1234.5
      })
    ).toEqual({
      delta: 12.5,
      name: "LCP",
      navigationType: "navigate",
      rating: "good",
      value: 1234.5
    });
  });

  it("rejects custom, non-finite, and out-of-range metrics", () => {
    expect(
      normalizeWebVital({
        delta: 1,
        name: "Next.js-render",
        navigationType: "navigate",
        rating: "good",
        value: 1
      })
    ).toBeNull();
    expect(
      normalizeWebVital({
        delta: 1,
        name: "LCP",
        navigationType: "navigate",
        rating: "good",
        value: Number.POSITIVE_INFINITY
      })
    ).toBeNull();
  });
});

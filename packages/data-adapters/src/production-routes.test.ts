import { describe, expect, it } from "vitest";

import { MORPHO_PRODUCTION_ROUTES, morphoProductionRouteSchema } from "./production-routes.js";

describe("Morpho production route identities", () => {
  it("contains canonical identity only and never preassigns observation IDs", () => {
    expect(MORPHO_PRODUCTION_ROUTES.length).toBeGreaterThan(0);
    for (const route of MORPHO_PRODUCTION_ROUTES) {
      expect(Object.keys(route).sort()).toEqual(["chainId", "contractAddress", "routeSlug"]);
      expect(JSON.stringify(route)).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu
      );
    }
  });

  it("rejects an observation reference attached to static route configuration", () => {
    expect(
      morphoProductionRouteSchema.safeParse({
        ...MORPHO_PRODUCTION_ROUTES[0],
        observationIds: [
          "10000000-0000-4000-8000-000000000001",
          "10000000-0000-4000-8000-000000000002",
          "10000000-0000-4000-8000-000000000003"
        ]
      }).success
    ).toBe(false);
  });

  it("keeps slugs and chain-address identities unique", () => {
    const slugs = MORPHO_PRODUCTION_ROUTES.map((route) => route.routeSlug);
    const identities = MORPHO_PRODUCTION_ROUTES.map(
      (route) => `${route.chainId}:${route.contractAddress.toLocaleLowerCase("en-US")}`
    );
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(identities).size).toBe(identities.length);
  });
});

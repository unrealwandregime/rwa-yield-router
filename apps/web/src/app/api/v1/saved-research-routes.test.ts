import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizationMocks = vi.hoisted(() => ({
  authorizeMutation: vi.fn(),
  authorizePrivateRequest: vi.fn()
}));

vi.mock("@/lib/authz", () => authorizationMocks);

import {
  GET as getComparisons,
  POST as postComparison
} from "@/app/api/v1/saved-comparisons/route";
import { GET as getViews, POST as postView } from "@/app/api/v1/saved-views/route";
import { isSavableRouteState } from "@/lib/saved-research-contract";

const denied = (status: number) => ({
  ok: false as const,
  response: Response.json({ error: "denied" }, { status })
});

beforeEach(() => {
  authorizationMocks.authorizeMutation.mockReset();
  authorizationMocks.authorizePrivateRequest.mockReset();
});

describe("saved research private API boundaries", () => {
  it("admits only current active published routes into a saved comparison", () => {
    const current = {
      archivedAt: null,
      effectiveTo: null,
      lifecycleStatus: "ACTIVE",
      publicationStatus: "PUBLISHED"
    };

    expect(isSavableRouteState(current)).toBe(true);
    expect(isSavableRouteState({ ...current, lifecycleStatus: "PAUSED" })).toBe(false);
    expect(isSavableRouteState({ ...current, publicationStatus: "DRAFT" })).toBe(false);
    expect(isSavableRouteState({ ...current, archivedAt: new Date() })).toBe(false);
    expect(isSavableRouteState({ ...current, effectiveTo: new Date() })).toBe(false);
  });

  it("owner-scoped reads require authenticated rate-limited authorization", async () => {
    authorizationMocks.authorizePrivateRequest.mockResolvedValue(denied(401));
    const comparisonsResponse = await getComparisons(
      new NextRequest("https://router.example/api/v1/saved-comparisons")
    );
    const viewsResponse = await getViews(
      new NextRequest("https://router.example/api/v1/saved-views")
    );

    expect(comparisonsResponse.status).toBe(401);
    expect(viewsResponse.status).toBe(401);
    expect(authorizationMocks.authorizePrivateRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        rateLimit: 60
      }
    );
    expect(authorizationMocks.authorizePrivateRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        rateLimit: 60
      }
    );
  });

  it("mutations require the CSRF-validating mutation boundary and a tighter rate limit", async () => {
    authorizationMocks.authorizeMutation.mockResolvedValue(denied(403));
    const comparisonResponse = await postComparison(
      new NextRequest("https://router.example/api/v1/saved-comparisons", {
        body: JSON.stringify({ name: "Private comparison", routeSlugs: ["a-route", "b-route"] }),
        method: "POST"
      })
    );
    const viewResponse = await postView(
      new NextRequest("https://router.example/api/v1/saved-views", {
        body: JSON.stringify({}),
        method: "POST"
      })
    );

    expect(comparisonResponse.status).toBe(403);
    expect(viewResponse.status).toBe(403);
    expect(authorizationMocks.authorizeMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      rateLimit: 20
    });
    expect(authorizationMocks.authorizeMutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      rateLimit: 20
    });
  });
});

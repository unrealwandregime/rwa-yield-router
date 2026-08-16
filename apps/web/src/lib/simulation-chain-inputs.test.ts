import { describe, expect, it } from "vitest";

import { canonicalizeSimulationChainInputs } from "./simulation-chain-inputs";

describe("simulation chain input normalization", () => {
  it("maps display names to canonical candidate chain identifiers", () => {
    expect(
      canonicalizeSimulationChainInputs(
        [
          { chain: "Ethereum", slug: "route-a" },
          { chain: "Base", slug: "route-b" }
        ],
        [
          { chainId: "eip155:1", routeId: "route-a" },
          { chainId: "eip155:8453", routeId: "route-b" }
        ],
        "ethereum",
        ["Ethereum", "Base", "eip155:1"]
      )
    ).toEqual({
      currentChainId: "eip155:1",
      preferredChainIds: ["eip155:1", "eip155:8453"]
    });
  });

  it("does not silently choose an ambiguous display alias", () => {
    expect(
      canonicalizeSimulationChainInputs(
        [
          { chain: "Shared chain", slug: "route-a" },
          { chain: "Shared chain", slug: "route-b" }
        ],
        [
          { chainId: "chain:1", routeId: "route-a" },
          { chainId: "chain:2", routeId: "route-b" }
        ],
        "Shared chain",
        ["Shared chain"]
      )
    ).toEqual({ currentChainId: "Shared chain", preferredChainIds: ["Shared chain"] });
  });
});

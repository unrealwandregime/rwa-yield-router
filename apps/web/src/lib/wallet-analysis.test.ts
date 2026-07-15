import { MORPHO_PRODUCTION_ROUTES } from "@rwa-yield-router/data-adapters";
import { describe, expect, it, vi } from "vitest";
import { analyzeWallet, WalletProviderUnavailableError } from "@/lib/wallet-analysis";

vi.mock("server-only", () => ({}));

const metricStatus = {
  aumTvl: { confidence: "UNAVAILABLE", observedAt: null, status: "UNAVAILABLE" as const },
  liquidity: { confidence: "UNAVAILABLE", observedAt: null, status: "UNAVAILABLE" as const },
  risk: { confidence: "UNAVAILABLE", observedAt: null, status: "UNAVAILABLE" as const },
  yield: {
    confidence: "DIRECT_API",
    observedAt: "2026-07-14T00:00:00.000Z",
    status: "CURRENT" as const
  }
};

const baseRoutes = MORPHO_PRODUCTION_ROUTES.filter((route) => route.chainId === 8453);
const catalog = baseRoutes.map((route, index) => ({
  category: "STABLECOIN_VAULT" as const,
  chain: "Base",
  confidence: "DIRECT_API",
  issuer: index === 0 ? "Issuer A" : "Issuer B",
  metricStatus,
  netApy: index === 0 ? "4.2" : null,
  productName: `Product ${index}`,
  protocol: "Morpho",
  routeName: `Route ${index}`,
  slug: route.routeSlug
}));

describe("read-only wallet analysis", () => {
  it("returns only non-zero canonical balances and makes incomplete coverage explicit", async () => {
    const recognizedAddress = baseRoutes[0]?.contractAddress;
    const result = await analyzeWallet({
      address: "0x0000000000000000000000000000000000000001",
      catalog,
      chain: "base",
      readRoute: async ({ route }) => ({
        balance: route.contractAddress === recognizedAddress ? 1_250_000n : 0n,
        decimals: 6,
        shareTokenSymbol: "mvUSDC"
      }),
      rpcUrl: "https://rpc.example.invalid"
    });

    expect(result.coverageStatus).toBe("COMPLETE_FOR_SUPPORTED_ROUTES");
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]).toMatchObject({
      balance: "1.25",
      currentNetApy: "4.2",
      shareTokenSymbol: "mvUSDC"
    });
    expect(result.unrecognizedCount).toBeNull();
    expect(result.exposureSummary.weighting).toBe("UNWEIGHTED_RECOGNIZED_POSITIONS_ONLY");
  });

  it("keeps a partial result when a supported contract read fails", async () => {
    const result = await analyzeWallet({
      address: "0x0000000000000000000000000000000000000001",
      catalog,
      chain: "base",
      readRoute: async ({ route }) => {
        if (route === baseRoutes[0]) throw new Error("secret provider detail");
        return { balance: 0n, decimals: 6, shareTokenSymbol: "mvUSDC" };
      },
      rpcUrl: "https://rpc.example.invalid/private-key"
    });
    expect(result.coverageStatus).toBe("PARTIAL");
    expect(result.failedRouteReads).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private-key");
    expect(JSON.stringify(result)).not.toContain("secret provider detail");
  });

  it("fails closed when every supported contract read fails", async () => {
    await expect(
      analyzeWallet({
        address: "0x0000000000000000000000000000000000000001",
        catalog,
        chain: "base",
        readRoute: async () => {
          throw new Error("provider failure");
        },
        rpcUrl: "https://rpc.example.invalid"
      })
    ).rejects.toBeInstanceOf(WalletProviderUnavailableError);
  });
});

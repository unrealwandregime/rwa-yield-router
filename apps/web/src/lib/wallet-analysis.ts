import "server-only";

import {
  MORPHO_PRODUCTION_ROUTES,
  type MorphoProductionRoute
} from "@rwa-yield-router/data-adapters";
import { base, mainnet, type Chain } from "viem/chains";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address
} from "viem";
import type { CatalogRecord } from "@/lib/catalog";

export const WALLET_CHAIN_VALUES = ["ethereum", "base"] as const;
export type WalletChain = (typeof WALLET_CHAIN_VALUES)[number];

const CHAIN_CONFIG: Readonly<Record<WalletChain, { chain: Chain; chainId: 1 | 8453 }>> = {
  base: { chain: base, chainId: 8453 },
  ethereum: { chain: mainnet, chainId: 1 }
};

type WalletCatalogRecord = Pick<
  CatalogRecord,
  | "category"
  | "chain"
  | "confidence"
  | "issuer"
  | "metricStatus"
  | "netApy"
  | "productName"
  | "protocol"
  | "routeName"
  | "slug"
>;

export interface WalletRouteRead {
  readonly balance: bigint;
  readonly decimals: number;
  readonly shareTokenSymbol: string;
}

export type WalletRouteReader = (input: {
  readonly account: Address;
  readonly chain: WalletChain;
  readonly route: MorphoProductionRoute;
  readonly rpcUrl: string;
}) => Promise<WalletRouteRead>;

export interface WalletHolding {
  readonly balance: string;
  readonly category: CatalogRecord["category"];
  readonly chain: WalletChain;
  readonly currentNetApy: string | null;
  readonly currentYieldConfidence: string;
  readonly currentYieldObservedAt: string | null;
  readonly currentYieldStatus: CatalogRecord["metricStatus"]["yield"]["status"];
  readonly issuer: string;
  readonly productName: string;
  readonly protocol: string | null;
  readonly routeName: string;
  readonly routeSlug: string;
  readonly shareTokenAddress: Address;
  readonly shareTokenSymbol: string;
}

export interface WalletAnalysisResult {
  readonly address: Address;
  readonly chain: WalletChain;
  readonly coverage: string;
  readonly coverageStatus: "COMPLETE_FOR_SUPPORTED_ROUTES" | "PARTIAL";
  readonly dataTimestamp: string;
  readonly exposureSummary: {
    readonly categories: readonly string[];
    readonly chains: readonly WalletChain[];
    readonly issuers: readonly string[];
    readonly protocols: readonly string[];
    readonly weighting: "UNWEIGHTED_RECOGNIZED_POSITIONS_ONLY";
  };
  readonly failedRouteReads: number;
  readonly holdings: readonly WalletHolding[];
  readonly limitations: readonly string[];
  readonly supportedRoutesScanned: number;
  readonly unrecognizedCount: null;
}

export class WalletProviderUnavailableError extends Error {
  constructor() {
    super("The configured read-only RPC could not return any supported route balances.");
    this.name = "WalletProviderUnavailableError";
  }
}

const defaultRouteReader: WalletRouteReader = async ({ account, chain, route, rpcUrl }) => {
  const client = createPublicClient({
    batch: { multicall: true },
    chain: CHAIN_CONFIG[chain].chain,
    transport: http(rpcUrl, { retryCount: 1, timeout: 6_000 })
  });
  const address = getAddress(route.contractAddress);
  const [balance, decimals, symbol] = await Promise.all([
    client.readContract({ abi: erc20Abi, address, args: [account], functionName: "balanceOf" }),
    client.readContract({ abi: erc20Abi, address, functionName: "decimals" }),
    client.readContract({ abi: erc20Abi, address, functionName: "symbol" })
  ]);
  return { balance, decimals, shareTokenSymbol: symbol };
};

const uniqueSorted = (values: ReadonlyArray<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export const getSupportedWalletChains = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): WalletChain[] =>
  WALLET_CHAIN_VALUES.filter((chain) =>
    chain === "ethereum" ? Boolean(environment.RPC_URL_ETHEREUM) : Boolean(environment.RPC_URL_BASE)
  );

export async function analyzeWallet(input: {
  readonly address: string;
  readonly catalog: ReadonlyArray<WalletCatalogRecord>;
  readonly chain: WalletChain;
  readonly rpcUrl: string;
  readonly readRoute?: WalletRouteReader;
}): Promise<WalletAnalysisResult> {
  if (!isAddress(input.address, { strict: false })) throw new TypeError("Invalid wallet address");
  const account = getAddress(input.address);
  const routes = MORPHO_PRODUCTION_ROUTES.filter(
    (route) => route.chainId === CHAIN_CONFIG[input.chain].chainId
  );
  const catalogBySlug = new Map(input.catalog.map((record) => [record.slug, record]));
  const readRoute = input.readRoute ?? defaultRouteReader;
  const reads = await Promise.allSettled(
    routes.map(async (route) => ({
      result: await readRoute({
        account,
        chain: input.chain,
        route,
        rpcUrl: input.rpcUrl
      }),
      route
    }))
  );
  const failedRouteReads = reads.filter((read) => read.status === "rejected").length;
  if (routes.length > 0 && failedRouteReads === routes.length)
    throw new WalletProviderUnavailableError();

  const holdings: WalletHolding[] = [];
  for (const read of reads) {
    if (read.status !== "fulfilled" || read.value.result.balance === 0n) continue;
    const record = catalogBySlug.get(read.value.route.routeSlug);
    if (!record) continue;
    holdings.push({
      balance: formatUnits(read.value.result.balance, read.value.result.decimals),
      category: record.category,
      chain: input.chain,
      currentNetApy: record.netApy,
      currentYieldConfidence: record.metricStatus.yield.confidence,
      currentYieldObservedAt: record.metricStatus.yield.observedAt,
      currentYieldStatus: record.metricStatus.yield.status,
      issuer: record.issuer,
      productName: record.productName,
      protocol: record.protocol,
      routeName: record.routeName,
      routeSlug: record.slug,
      shareTokenAddress: getAddress(read.value.route.contractAddress),
      shareTokenSymbol: read.value.result.shareTokenSymbol
    });
  }
  holdings.sort((left, right) => left.productName.localeCompare(right.productName));

  return {
    address: account,
    chain: input.chain,
    coverage:
      "Only the canonical supported vault-share contracts listed by RWA Yield Router were queried through the configured server-side RPC.",
    coverageStatus: failedRouteReads === 0 ? "COMPLETE_FOR_SUPPORTED_ROUTES" : "PARTIAL",
    dataTimestamp: new Date().toISOString(),
    exposureSummary: {
      categories: uniqueSorted(holdings.map((holding) => holding.category)),
      chains: holdings.length > 0 ? [input.chain] : [],
      issuers: uniqueSorted(holdings.map((holding) => holding.issuer)),
      protocols: uniqueSorted(
        holdings.flatMap((holding) => (holding.protocol === null ? [] : [holding.protocol]))
      ),
      weighting: "UNWEIGHTED_RECOGNIZED_POSITIONS_ONLY"
    },
    failedRouteReads,
    holdings,
    limitations: [
      "This is not a complete token-portfolio scan; unrelated token contracts are not enumerated.",
      "Unrecognized position count, USD value, and value-weighted concentration are unavailable.",
      "Vault-share balances are shown in share-token units and are not represented as underlying assets or USD.",
      "No wallet signature, token approval, transaction, swap, deposit, withdrawal, or rebalance is requested or constructed."
    ],
    supportedRoutesScanned: routes.length,
    unrecognizedCount: null
  };
}

import type { RouteCandidate } from "@rwa-yield-router/routing-engine";

import type { CatalogRecord } from "@/lib/catalog";

const normalizedAlias = (value: string): string => value.trim().toLocaleLowerCase("en-US");

export interface CanonicalSimulationChainInputs {
  readonly currentChainId: string;
  readonly preferredChainIds: readonly string[];
}

export function canonicalizeSimulationChainInputs(
  records: readonly Pick<CatalogRecord, "chain" | "slug">[],
  candidates: readonly Pick<RouteCandidate, "chainId" | "routeId">[],
  currentChain: string,
  preferredChains: readonly string[]
): CanonicalSimulationChainInputs {
  const recordsBySlug = new Map(records.map((record) => [record.slug, record]));
  const aliases = new Map<string, string | null>();
  const register = (alias: string, chainId: string) => {
    const key = normalizedAlias(alias);
    const existing = aliases.get(key);
    aliases.set(key, existing === undefined || existing === chainId ? chainId : null);
  };
  for (const candidate of candidates) {
    register(candidate.chainId, candidate.chainId);
    const record = recordsBySlug.get(candidate.routeId);
    if (record !== undefined) register(record.chain, candidate.chainId);
  }
  const resolve = (value: string): string => aliases.get(normalizedAlias(value)) ?? value.trim();
  return {
    currentChainId: resolve(currentChain),
    preferredChainIds: [...new Set(preferredChains.map(resolve))]
  };
}

import { z } from "zod";

export const morphoProductionRouteSchema = z
  .object({
    routeSlug: z.string().min(1),
    chainId: z.union([z.literal(1), z.literal(8453)]),
    contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u)
  })
  .strict();

export type MorphoProductionRoute = z.infer<typeof morphoProductionRouteSchema>;

/**
 * Canonical MetaMorpho vault identities reconciled against the official
 * Morpho GraphQL API on 2026-07-14. Values are intentionally not stored here;
 * the API is queried at runtime and these identities only constrain matching.
 * Observation UUIDs are database-generated during ingestion and never belong
 * in static route identity configuration.
 */
export const MORPHO_PRODUCTION_ROUTES: ReadonlyArray<MorphoProductionRoute> = z
  .array(morphoProductionRouteSchema)
  .parse([
    {
      routeSlug: "gauntlet-usdc-prime-base",
      chainId: 8453,
      contractAddress: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"
    },
    {
      routeSlug: "steakhouse-prime-usdc-base",
      chainId: 8453,
      contractAddress: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2"
    },
    {
      routeSlug: "steakhouse-usdc-base",
      chainId: 8453,
      contractAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183"
    },
    {
      routeSlug: "steakhouse-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB"
    },
    {
      routeSlug: "steakhouse-usdt-ethereum",
      chainId: 1,
      contractAddress: "0xbEef047a543E45807105E51A8BBEFCc5950fcfBa"
    },
    {
      routeSlug: "gauntlet-usdc-prime-ethereum",
      chainId: 1,
      contractAddress: "0xdd0f28e19C1780eb6396170735D45153D261490d"
    },
    {
      routeSlug: "smokehouse-usdt-ethereum",
      chainId: 1,
      contractAddress: "0xA0804346780b4c2e3bE118ac957D1DB82F9d7484"
    },
    {
      routeSlug: "vault-bridge-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEefb9f61CC44895d8AEc381373555a64191A9c4"
    },
    {
      routeSlug: "smokehouse-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC"
    },
    {
      routeSlug: "hakutora-usdc-ethereum",
      chainId: 1,
      contractAddress: "0x974c8FBf4fd795F66B85B73ebC988A51F1A040a9"
    }
  ]);

export const MORPHO_API_URL = "https://api.morpho.org/graphql";

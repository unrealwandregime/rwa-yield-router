import { z } from "zod";

export const morphoProductionRouteSchema = z
  .object({
    routeSlug: z.string().min(1),
    chainId: z.union([z.literal(1), z.literal(8453)]),
    contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
    observationIds: z.tuple([z.uuid(), z.uuid(), z.uuid()])
  })
  .strict();

export type MorphoProductionRoute = z.infer<typeof morphoProductionRouteSchema>;

/**
 * Canonical MetaMorpho vault identities reconciled against the official
 * Morpho GraphQL API on 2026-07-14. Values are intentionally not stored here;
 * the API is queried at runtime and these identities only constrain matching.
 */
export const MORPHO_PRODUCTION_ROUTES: ReadonlyArray<MorphoProductionRoute> = z
  .array(morphoProductionRouteSchema)
  .parse([
    {
      routeSlug: "gauntlet-usdc-prime-base",
      chainId: 8453,
      contractAddress: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
      observationIds: [
        "a9668253-5ee8-4bcd-a7bc-1f45c714197a",
        "0c1ea73f-1985-414a-aecd-704cc0621517",
        "00a39fe5-b12e-4d0d-9566-252f1b0f74dd"
      ]
    },
    {
      routeSlug: "steakhouse-prime-usdc-base",
      chainId: 8453,
      contractAddress: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
      observationIds: [
        "b4c6de42-2969-4440-acfb-ef0828bcd72f",
        "c9415d0d-31cb-4450-aca6-12e5d199aeda",
        "ff4083b2-ef6e-429d-9fea-ae5e2638ffc3"
      ]
    },
    {
      routeSlug: "steakhouse-usdc-base",
      chainId: 8453,
      contractAddress: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
      observationIds: [
        "b65aaf8d-cc0d-422c-8d3a-e9a554f7bf8e",
        "4e4d7ffe-ab74-4259-9120-690ed991fa26",
        "bb9bccfe-bb45-4f34-9d9c-8214de703a7c"
      ]
    },
    {
      routeSlug: "steakhouse-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
      observationIds: [
        "898fdd35-1d85-47fd-b740-9dd27f9c1eb4",
        "5f7940c6-9692-4be5-98ac-6697bba48639",
        "8b519b6d-947d-4642-b60b-155c420fe044"
      ]
    },
    {
      routeSlug: "steakhouse-usdt-ethereum",
      chainId: 1,
      contractAddress: "0xbEef047a543E45807105E51A8BBEFCc5950fcfBa",
      observationIds: [
        "a0abdfdf-bca8-43d0-a81e-83473c86c553",
        "0b4ddd6f-2ccb-4723-b8be-a3e09fd7185e",
        "280bf5b1-6ba8-4336-a753-f21c08475144"
      ]
    },
    {
      routeSlug: "gauntlet-usdc-prime-ethereum",
      chainId: 1,
      contractAddress: "0xdd0f28e19C1780eb6396170735D45153D261490d",
      observationIds: [
        "88ac0e3f-118f-4d00-8f81-4c40ef372123",
        "0bc69ea2-b4ed-419f-a2e3-7836f9c7664a",
        "8d1de1cd-bb1b-4a34-b543-d8ba9a026e90"
      ]
    },
    {
      routeSlug: "smokehouse-usdt-ethereum",
      chainId: 1,
      contractAddress: "0xA0804346780b4c2e3bE118ac957D1DB82F9d7484",
      observationIds: [
        "1bf7333a-5e82-47f4-a988-84508c1b640b",
        "35bc4347-f388-4cf1-ae4a-8791317135c0",
        "2ed4e7a3-65be-4f56-a363-5ed866abba6a"
      ]
    },
    {
      routeSlug: "vault-bridge-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEefb9f61CC44895d8AEc381373555a64191A9c4",
      observationIds: [
        "6ba74328-35ea-4cc3-9c94-33f96c970409",
        "4994fbfc-cca5-4beb-817a-6d857d94baaf",
        "c4da1a5a-60fa-45f1-a0ea-85be4bfaf096"
      ]
    },
    {
      routeSlug: "smokehouse-usdc-ethereum",
      chainId: 1,
      contractAddress: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC",
      observationIds: [
        "12fba94f-696b-445b-8149-6b1cbaefc930",
        "8e2bbff6-3169-4a46-a383-dd737268b524",
        "1a1dd206-ffe3-4813-8385-f664703ff12c"
      ]
    },
    {
      routeSlug: "hakutora-usdc-ethereum",
      chainId: 1,
      contractAddress: "0x974c8FBf4fd795F66B85B73ebC988A51F1A040a9",
      observationIds: [
        "3539ee11-843b-494f-869c-3f71058607e1",
        "7d527506-1127-4e34-b9c1-4dbd91f7eb6a",
        "fa5377b1-ab8e-49f3-a43b-ba4cb5265898"
      ]
    }
  ]);

export const MORPHO_API_URL = "https://api.morpho.org/graphql";

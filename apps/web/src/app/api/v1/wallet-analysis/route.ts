import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, checkRateLimit, requestIdentity, validateBrowserMutation } from "@/lib/api";
import { getLiveCatalog } from "@/lib/live-morpho";
import {
  analyzeWallet,
  WALLET_CHAIN_VALUES,
  WalletProviderUnavailableError
} from "@/lib/wallet-analysis";

const requestSchema = z
  .object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
    chain: z.enum(WALLET_CHAIN_VALUES)
  })
  .strict();

const rpcUrlFor = (chain: (typeof WALLET_CHAIN_VALUES)[number]): string | undefined =>
  chain === "ethereum" ? process.env.RPC_URL_ETHEREUM : process.env.RPC_URL_BASE;

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!validateBrowserMutation(request.url, request.headers))
    return apiError(
      403,
      "AUTHORIZATION_DENIED",
      "Browser mutation validation failed.",
      correlationId
    );
  const rate = await checkRateLimit(
    `wallet-analysis:${requestIdentity(request.headers)}`,
    10,
    60_000
  );
  if (!rate.allowed)
    return apiError(429, "RATE_LIMITED", "Wallet-analysis rate limit exceeded.", correlationId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.", correlationId);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Wallet-analysis inputs are invalid.",
      correlationId,
      parsed.error.flatten()
    );
  const rpcUrl = rpcUrlFor(parsed.data.chain);
  if (!rpcUrl)
    return apiError(
      503,
      "CONFIGURATION_UNAVAILABLE",
      `Read-only ${parsed.data.chain} analysis is not configured.`,
      correlationId
    );

  try {
    const result = await analyzeWallet({
      address: parsed.data.address,
      catalog: await getLiveCatalog(),
      chain: parsed.data.chain,
      rpcUrl
    });
    return Response.json(result, {
      headers: {
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
        "x-rate-limit-remaining": String(rate.remaining),
        "x-rate-limit-reset": String(Math.ceil(rate.resetAt / 1_000))
      }
    });
  } catch (error) {
    if (error instanceof TypeError)
      return apiError(400, "VALIDATION_ERROR", "Wallet address is invalid.", correlationId);
    if (error instanceof WalletProviderUnavailableError)
      return apiError(
        503,
        "CONFIGURATION_UNAVAILABLE",
        "The configured read-only provider is temporarily unavailable.",
        correlationId
      );
    return apiError(
      503,
      "CONFIGURATION_UNAVAILABLE",
      "Read-only wallet analysis is temporarily unavailable.",
      correlationId
    );
  }
}

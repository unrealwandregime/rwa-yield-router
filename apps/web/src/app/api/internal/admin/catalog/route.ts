import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  adminAuditLogs,
  assets,
  chains,
  issuers,
  productCategories,
  products,
  productRoutes,
  sourceRegistry
} from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";
import { CATEGORY_VALUES } from "@/lib/constants";

const createSchema = z
  .object({
    accessMethod: z.enum([
      "ISSUER_MINT",
      "ISSUER_REDEMPTION",
      "DEX_PURCHASE",
      "LENDING_DEPOSIT",
      "VAULT_DEPOSIT",
      "NATIVE_HOLD"
    ]),
    caip2Id: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}$/u, "Expected a CAIP-2 chain id"),
    category: z.enum(CATEGORY_VALUES),
    chain: z.string().trim().min(1).max(80),
    issuer: z.string().trim().min(1).max(100),
    productName: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(8).max(2_000),
    routeName: z.string().trim().min(1).max(200),
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    symbol: z.string().trim().min(1).max(32),
    underlyingAsset: z.string().trim().min(1).max(120),
    verificationDate: z.iso.date()
  })
  .strict();

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  return slug.slice(0, 120) || `record-${randomUUID().slice(0, 8)}`;
};

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 20 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Catalog draft is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const input = parsed.data;
  const verificationDate = new Date(`${input.verificationDate}T00:00:00.000Z`);
  const now = new Date();
  if (verificationDate > now)
    return apiError(400, "VALIDATION_ERROR", "Verification date cannot be in the future.");
  const productSlug = slugify(`${input.productName}-${input.symbol}`);
  const routeSlug = slugify(`${input.productName}-${input.routeName}-${input.chain}`);
  const correlationId = randomUUID();

  try {
    const created = await access.value.database.transaction(async (transaction) => {
      const [category] = await transaction
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(eq(productCategories.code, input.category))
        .limit(1);
      if (!category) throw new Error("Product categories have not been seeded");

      await transaction
        .insert(assets)
        .values({
          assetType: input.category,
          name: input.productName,
          symbol: input.symbol.toUpperCase()
        })
        .onConflictDoNothing({ target: [assets.symbol, assets.assetType] });
      const [asset] = await transaction
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(eq(assets.symbol, input.symbol.toUpperCase()), eq(assets.assetType, input.category))
        )
        .limit(1);
      if (!asset) throw new Error("Asset invariant failed");

      await transaction
        .insert(issuers)
        .values({ name: input.issuer })
        .onConflictDoNothing({ target: issuers.name });
      const [issuer] = await transaction
        .select({ id: issuers.id })
        .from(issuers)
        .where(eq(issuers.name, input.issuer))
        .limit(1);
      if (!issuer) throw new Error("Issuer invariant failed");

      await transaction
        .insert(chains)
        .values({ caip2Id: input.caip2Id, name: input.chain })
        .onConflictDoNothing({ target: chains.caip2Id });
      const [chain] = await transaction
        .select({ id: chains.id })
        .from(chains)
        .where(eq(chains.caip2Id, input.caip2Id))
        .limit(1);
      if (!chain) throw new Error("Chain invariant failed");

      const sourceCode = `ADMIN-${createHash("sha256").update(input.sourceUrl).digest("hex").slice(0, 24)}`;
      await transaction
        .insert(sourceRegistry)
        .values({
          canonicalUrl: input.sourceUrl,
          code: sourceCode,
          name: `${input.issuer} admin-curated source`,
          ownerName: new URL(input.sourceUrl).hostname,
          priority: 100,
          publicationStatus: "DRAFT",
          removalProcedure:
            "Archive this source version and create a replacement after reviewed evidence changes.",
          sourceType: "OFFICIAL_DOCUMENT"
        })
        .onConflictDoNothing({ target: [sourceRegistry.code, sourceRegistry.version] });
      const [source] = await transaction
        .select({ id: sourceRegistry.id })
        .from(sourceRegistry)
        .where(eq(sourceRegistry.code, sourceCode))
        .limit(1);
      if (!source) throw new Error("Source invariant failed");

      const [product] = await transaction
        .insert(products)
        .values({
          categoryId: category.id,
          effectiveFrom: now,
          issuerId: issuer.id,
          name: input.productName,
          primaryAssetId: asset.id,
          publicationStatus: "DRAFT",
          slug: productSlug,
          symbol: input.symbol.toUpperCase(),
          verifiedAt: verificationDate
        })
        .returning({ id: products.id, version: products.version });
      if (!product) throw new Error("Product invariant failed");
      const [route] = await transaction
        .insert(productRoutes)
        .values({
          accessMethod: input.accessMethod,
          chainId: chain.id,
          depositAssetId: input.accessMethod === "NATIVE_HOLD" ? asset.id : null,
          effectiveFrom: now,
          isNative: input.accessMethod === "NATIVE_HOLD",
          name: input.routeName,
          productId: product.id,
          publicationStatus: "DRAFT",
          slug: routeSlug,
          verifiedAt: verificationDate
        })
        .returning({
          id: productRoutes.id,
          slug: productRoutes.slug,
          version: productRoutes.version
        });
      if (!route) throw new Error("Route invariant failed");

      await transaction.insert(adminAuditLogs).values({
        action: "CATALOG_DRAFT_CREATE",
        actorUserId: access.value.authorization.userId,
        afterValue: { input, productId: product.id, routeId: route.id, routeSlug },
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: input.reason,
        sourceId: source.id,
        targetId: route.id,
        targetRecordVersion: route.version,
        targetType: "PRODUCT_ROUTE",
        verificationDate
      });
      return { productId: product.id, routeId: route.id, routeSlug: route.slug };
    });
    return Response.json(
      { data: created, status: "DRAFT_CREATED" },
      { headers: { "cache-control": "no-store", "x-correlation-id": correlationId }, status: 201 }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The draft conflicts with existing versioned catalog data or required reference data is missing.",
      correlationId
    );
  }
}

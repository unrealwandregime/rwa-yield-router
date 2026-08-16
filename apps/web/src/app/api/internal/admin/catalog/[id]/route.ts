import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import {
  adminAuditLogs,
  products,
  productRoutes,
  sourceRegistry
} from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";

const actionSchema = z
  .object({
    action: z.enum(["ARCHIVE", "PUBLISH", "REJECT", "SET_LIFECYCLE", "VERIFY"]),
    lifecycleStatus: z.enum(["ACTIVE", "PAUSED", "RESTRICTED", "CLOSED", "UNAVAILABLE"]).optional(),
    reason: z.string().trim().min(8).max(2_000),
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    verificationDate: z.iso.datetime({ offset: true })
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "SET_LIFECYCLE" && input.lifecycleStatus === undefined) {
      context.addIssue({ code: "custom", message: "Lifecycle action requires a lifecycle status" });
    }
    if (input.action !== "SET_LIFECYCLE" && input.lifecycleStatus !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Lifecycle status is only valid for that action"
      });
    }
  });

const editSchema = z
  .object({
    productName: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(8).max(2_000),
    requiresKyc: z.boolean().nullable(),
    routeName: z.string().trim().min(1).max(200),
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    symbol: z.string().trim().min(1).max(32),
    verificationDate: z.iso.datetime({ offset: true })
  })
  .strict();

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 20 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = editSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Catalog edit is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const { id: routeSlug } = await context.params;
  const now = new Date();
  const verificationDate = new Date(parsed.data.verificationDate);
  if (verificationDate > now)
    return apiError(400, "VALIDATION_ERROR", "Verification time cannot be in the future.");
  const effectiveFrom = now;
  const correlationId = randomUUID();

  try {
    const edited = await access.value.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          product: {
            categoryId: products.categoryId,
            denominationAssetId: products.denominationAssetId,
            description: products.description,
            effectiveFrom: products.effectiveFrom,
            id: products.id,
            issuerId: products.issuerId,
            logicalId: products.logicalId,
            primaryAssetId: products.primaryAssetId,
            slug: products.slug,
            version: products.version
          },
          route: {
            accessMethod: productRoutes.accessMethod,
            chainId: productRoutes.chainId,
            depositAssetId: productRoutes.depositAssetId,
            effectiveFrom: productRoutes.effectiveFrom,
            id: productRoutes.id,
            isNative: productRoutes.isNative,
            logicalId: productRoutes.logicalId,
            protocolId: productRoutes.protocolId,
            receiptAssetId: productRoutes.receiptAssetId,
            slug: productRoutes.slug,
            version: productRoutes.version
          }
        })
        .from(productRoutes)
        .innerJoin(products, eq(productRoutes.productId, products.id))
        .where(and(eq(productRoutes.slug, routeSlug), isNull(productRoutes.effectiveTo)))
        .limit(1);
      if (current === undefined) return null;
      const [source] = await transaction
        .select({ id: sourceRegistry.id, status: sourceRegistry.status })
        .from(sourceRegistry)
        .where(
          and(
            eq(sourceRegistry.canonicalUrl, parsed.data.sourceUrl),
            ne(sourceRegistry.status, "REMOVED"),
            or(
              eq(sourceRegistry.publicationStatus, "REVIEWED"),
              eq(sourceRegistry.publicationStatus, "PUBLISHED")
            )
          )
        )
        .orderBy(desc(sourceRegistry.version))
        .limit(1);
      if (!source) throw new Error("A current source is required for a catalog edit");
      if (
        effectiveFrom <= current.product.effectiveFrom ||
        effectiveFrom <= current.route.effectiveFrom
      )
        throw new Error("Edit effective time must be later than the current version");

      await transaction
        .update(productRoutes)
        .set({
          effectiveTo: effectiveFrom,
          publicationStatus: "SUPERSEDED",
          updatedAt: effectiveFrom
        })
        .where(eq(productRoutes.id, current.route.id));
      await transaction
        .update(products)
        .set({
          effectiveTo: effectiveFrom,
          publicationStatus: "SUPERSEDED",
          updatedAt: effectiveFrom
        })
        .where(eq(products.id, current.product.id));
      const [newProduct] = await transaction
        .insert(products)
        .values({
          categoryId: current.product.categoryId,
          denominationAssetId: current.product.denominationAssetId,
          description: current.product.description,
          effectiveFrom,
          issuerId: current.product.issuerId,
          logicalId: current.product.logicalId,
          name: parsed.data.productName,
          primaryAssetId: current.product.primaryAssetId,
          publicationStatus: "DRAFT",
          slug: current.product.slug,
          symbol: parsed.data.symbol.toUpperCase(),
          verifiedAt: verificationDate,
          version: current.product.version + 1
        })
        .returning({ id: products.id, version: products.version });
      if (newProduct === undefined) throw new Error("Edited product was not created");
      const [newRoute] = await transaction
        .insert(productRoutes)
        .values({
          accessMethod: current.route.accessMethod,
          chainId: current.route.chainId,
          depositAssetId: current.route.depositAssetId,
          effectiveFrom,
          isNative: current.route.isNative,
          logicalId: current.route.logicalId,
          name: parsed.data.routeName,
          productId: newProduct.id,
          protocolId: current.route.protocolId,
          publicationStatus: "DRAFT",
          receiptAssetId: current.route.receiptAssetId,
          requiresKyc: parsed.data.requiresKyc,
          slug: current.route.slug,
          verifiedAt: verificationDate,
          version: current.route.version + 1
        })
        .returning({ id: productRoutes.id, version: productRoutes.version });
      if (newRoute === undefined) throw new Error("Edited route was not created");
      await transaction.insert(adminAuditLogs).values({
        action: "CATALOG_EDIT_VERSION_CREATE",
        actorUserId: access.value.authorization.userId,
        afterValue: {
          productId: newProduct.id,
          productName: parsed.data.productName,
          requiresKyc: parsed.data.requiresKyc,
          routeId: newRoute.id,
          routeName: parsed.data.routeName,
          sourceUrl: parsed.data.sourceUrl,
          symbol: parsed.data.symbol.toUpperCase()
        },
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: parsed.data.reason,
        sourceId: source.id,
        targetId: newRoute.id,
        targetRecordVersion: newRoute.version,
        targetType: "PRODUCT_ROUTE",
        verificationDate
      });
      return { productId: newProduct.id, routeId: newRoute.id, routeVersion: newRoute.version };
    });
    if (edited === null)
      return apiError(404, "NOT_FOUND", "Current catalog route not found.", correlationId);
    return Response.json(
      { data: edited, status: "DRAFT_VERSION_CREATED" },
      { headers: { "cache-control": "no-store", "x-correlation-id": correlationId } }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "A new version could not be created from the current catalog record.",
      correlationId
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 30 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Catalog review action is invalid.",
      undefined,
      parsed.error.flatten()
    );
  const { id: routeSlug } = await context.params;
  const now = new Date();
  const verificationDate = new Date(parsed.data.verificationDate);
  if (verificationDate > now)
    return apiError(400, "VALIDATION_ERROR", "Verification time cannot be in the future.");
  const correlationId = randomUUID();

  try {
    const changed = await access.value.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          productId: productRoutes.productId,
          productPublicationStatus: products.publicationStatus,
          routeId: productRoutes.id,
          routeLifecycleStatus: productRoutes.lifecycleStatus,
          routeName: productRoutes.name,
          routePublicationStatus: productRoutes.publicationStatus,
          routeVersion: productRoutes.version
        })
        .from(productRoutes)
        .innerJoin(products, eq(productRoutes.productId, products.id))
        .where(and(eq(productRoutes.slug, routeSlug), isNull(productRoutes.effectiveTo)))
        .limit(1);
      if (!current) return null;
      const [source] = await transaction
        .select({
          id: sourceRegistry.id,
          publicationStatus: sourceRegistry.publicationStatus,
          status: sourceRegistry.status
        })
        .from(sourceRegistry)
        .where(
          and(
            eq(sourceRegistry.canonicalUrl, parsed.data.sourceUrl),
            ne(sourceRegistry.status, "REMOVED"),
            or(
              eq(sourceRegistry.publicationStatus, "REVIEWED"),
              eq(sourceRegistry.publicationStatus, "PUBLISHED")
            )
          )
        )
        .orderBy(desc(sourceRegistry.version))
        .limit(1);
      if (!source) throw new Error("A current source is required for a catalog transition");

      if (parsed.data.action === "VERIFY") {
        if (
          current.routePublicationStatus !== "DRAFT" &&
          current.routePublicationStatus !== "REVIEWED"
        )
          throw new Error("Only draft or reviewed records can be verified");
        if (source.publicationStatus !== "REVIEWED" && source.publicationStatus !== "PUBLISHED")
          throw new Error("The source must be reviewed before catalog verification");
        await transaction
          .update(productRoutes)
          .set({ publicationStatus: "REVIEWED", updatedAt: now, verifiedAt: verificationDate })
          .where(eq(productRoutes.id, current.routeId));
        await transaction
          .update(products)
          .set({ publicationStatus: "REVIEWED", updatedAt: now, verifiedAt: verificationDate })
          .where(eq(products.id, current.productId));
      } else if (parsed.data.action === "PUBLISH") {
        if (current.routePublicationStatus !== "REVIEWED")
          throw new Error("Verification is required before publication");
        if (source.publicationStatus !== "PUBLISHED")
          throw new Error("The source must be published before catalog publication");
        await transaction
          .update(productRoutes)
          .set({
            publicationStatus: "PUBLISHED",
            publishedAt: now,
            updatedAt: now,
            verifiedAt: verificationDate
          })
          .where(eq(productRoutes.id, current.routeId));
        await transaction
          .update(products)
          .set({
            publicationStatus: "PUBLISHED",
            publishedAt: now,
            updatedAt: now,
            verifiedAt: verificationDate
          })
          .where(eq(products.id, current.productId));
      } else if (parsed.data.action === "REJECT") {
        if (
          current.routePublicationStatus !== "DRAFT" &&
          current.routePublicationStatus !== "REVIEWED"
        )
          throw new Error("Only draft or reviewed records can be rejected");
        await transaction
          .update(productRoutes)
          .set({ publicationStatus: "REJECTED", updatedAt: now })
          .where(eq(productRoutes.id, current.routeId));
        await transaction
          .update(products)
          .set({ publicationStatus: "REJECTED", updatedAt: now })
          .where(eq(products.id, current.productId));
      } else if (parsed.data.action === "SET_LIFECYCLE") {
        if (parsed.data.lifecycleStatus === undefined)
          throw new Error("Lifecycle status is required");
        await transaction
          .update(productRoutes)
          .set({ lifecycleStatus: parsed.data.lifecycleStatus, updatedAt: now })
          .where(eq(productRoutes.id, current.routeId));
      } else {
        await transaction
          .update(productRoutes)
          .set({
            archivedAt: now,
            effectiveTo: now,
            lifecycleStatus: "ARCHIVED",
            publicationStatus: "ARCHIVED",
            updatedAt: now
          })
          .where(eq(productRoutes.id, current.routeId));
        await transaction
          .update(products)
          .set({
            archivedAt: now,
            effectiveTo: now,
            lifecycleStatus: "ARCHIVED",
            publicationStatus: "ARCHIVED",
            updatedAt: now
          })
          .where(eq(products.id, current.productId));
      }

      const afterValue = {
        action: parsed.data.action,
        lifecycleStatus:
          parsed.data.action === "SET_LIFECYCLE"
            ? parsed.data.lifecycleStatus
            : current.routeLifecycleStatus,
        publicationStatus:
          parsed.data.action === "VERIFY"
            ? "REVIEWED"
            : parsed.data.action === "PUBLISH"
              ? "PUBLISHED"
              : parsed.data.action === "REJECT"
                ? "REJECTED"
                : parsed.data.action === "SET_LIFECYCLE"
                  ? current.routePublicationStatus
                  : "ARCHIVED",
        sourceUrl: parsed.data.sourceUrl,
        verificationDate: parsed.data.verificationDate
      };
      await transaction.insert(adminAuditLogs).values({
        action: `CATALOG_${parsed.data.action}`,
        actorUserId: access.value.authorization.userId,
        afterValue,
        beforeValue: current,
        correlationId,
        occurredAt: now,
        outcome: "APPROVED",
        reason: parsed.data.reason,
        sourceId: source.id,
        targetId: current.routeId,
        targetRecordVersion: current.routeVersion,
        targetType: "PRODUCT_ROUTE",
        verificationDate
      });
      return { id: current.routeId, status: afterValue.publicationStatus };
    });
    if (!changed)
      return apiError(404, "NOT_FOUND", "Current catalog route not found.", correlationId);
    return Response.json(
      { data: changed, status: "UPDATED" },
      { headers: { "cache-control": "no-store", "x-correlation-id": correlationId } }
    );
  } catch {
    return apiError(
      409,
      "VALIDATION_ERROR",
      "The versioned review transition is not allowed from the current state.",
      correlationId
    );
  }
}

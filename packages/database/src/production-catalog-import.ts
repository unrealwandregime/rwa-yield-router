import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  productionCatalog,
  productionCatalogRecordSchema,
  validateProductionCatalog,
  type ProductionCatalogRecord,
  type SourceType
} from "@rwa-yield-router/data-adapters";

import type { Database } from "./client.js";
import {
  assets,
  catalogImportBatches,
  catalogImportRecords,
  chains,
  issuers,
  productCategories,
  productRoutes,
  products,
  productYieldSources,
  protocols,
  sourceRegistry,
  yieldSources
} from "./schema/index.js";
import { seedCanonicalReferenceData } from "./seed.js";

const IMPORTER_VERSION = "production-catalog-import-v1.1.0";
const IMPORT_LOCK_KEY = "rwa-yield-router:production-catalog-import";

type DatabaseSourceType = (typeof sourceRegistry.$inferInsert)["sourceType"];
type DatabaseAccessMethod = (typeof productRoutes.$inferInsert)["accessMethod"];

const sourceTypeMap: Readonly<Record<SourceType, DatabaseSourceType>> = {
  MANUAL: "MANUAL_CURATED",
  OFFICIAL_API: "OFFICIAL_API",
  OFFICIAL_DOCUMENT: "OFFICIAL_DOCUMENT",
  ONCHAIN: "ONCHAIN",
  THIRD_PARTY_API: "THIRD_PARTY_API"
};

const accessMethodMap: Readonly<Record<ProductionCatalogRecord["category"], DatabaseAccessMethod>> =
  {
    CASH_EQUIVALENT: "NATIVE_HOLD",
    DEFI_LENDING: "LENDING_DEPOSIT",
    GOLD_BACKED_TOKEN: "NATIVE_HOLD",
    MONEY_MARKET_TOKEN: "ISSUER_MINT",
    STABLECOIN_VAULT: "VAULT_DEPOSIT",
    TOKENIZED_TBILL: "ISSUER_MINT"
  };

const caip2ByChainLabel: Readonly<Record<string, string>> = {
  Arbitrum: "eip155:42161",
  Base: "eip155:8453",
  "BNB Chain": "eip155:56",
  Ethereum: "eip155:1",
  Mantle: "eip155:5000",
  Optimism: "eip155:10",
  Polygon: "eip155:137",
  Solana: "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ",
  Stellar: "stellar:pubnet",
  XDC: "eip155:50",
  XRPL: "xrpl:0"
};

const hashJson = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const canonicalCatalogPayload = (
  records: ReadonlyArray<ProductionCatalogRecord>
): ReadonlyArray<ProductionCatalogRecord> =>
  [...records].sort((left, right) => left.id.localeCompare(right.id, "en-US"));

export interface ProductionCatalogImportPlan {
  readonly payloadSha256: string;
  readonly recordCount: number;
  readonly draftCount: number;
  readonly gatedCount: number;
  readonly publishedCount: number;
  readonly verifiedAt: Date;
  readonly records: ReadonlyArray<ProductionCatalogRecord>;
}

export interface ProductionCatalogImportResult {
  readonly batchId: string;
  readonly outcome: "IMPORTED" | "DUPLICATE";
  readonly recordsImported: number;
  readonly gatedRecords: number;
  readonly publishedRecords: number;
  readonly payloadSha256: string;
}

export const caip2IdForCatalogChain = (chainLabel: string): string | null =>
  caip2ByChainLabel[chainLabel] ?? null;

export const buildProductionCatalogImportPlan = (
  records: ReadonlyArray<ProductionCatalogRecord> = productionCatalog
): ProductionCatalogImportPlan => {
  const canonicalRecords = canonicalCatalogPayload(
    records.map((record) => productionCatalogRecordSchema.parse(record))
  );
  const report = validateProductionCatalog(canonicalRecords);
  if (report.gated + report.published !== report.total) {
    throw new Error("Production import accepts only gated or published catalog records");
  }
  if (records.length === 0) {
    throw new Error("A production catalog import cannot be empty");
  }
  const verifiedAt = new Date(
    Math.max(...canonicalRecords.map((record) => new Date(record.verifiedAt).getTime()))
  );
  return {
    draftCount: 0,
    gatedCount: report.gated,
    payloadSha256: hashJson(canonicalRecords),
    publishedCount: report.published,
    recordCount: report.total,
    records: canonicalRecords,
    verifiedAt
  };
};

export const importProductionCatalog = async (
  database: Database,
  input: Readonly<{
    correlationId?: string;
    records?: ReadonlyArray<ProductionCatalogRecord>;
  }> = {}
): Promise<ProductionCatalogImportResult> => {
  const plan = buildProductionCatalogImportPlan(input.records ?? productionCatalog);
  await seedCanonicalReferenceData(database);
  const correlationId = input.correlationId ?? randomUUID();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${IMPORT_LOCK_KEY}))`);

    const [latestBatch] = await transaction
      .select({ id: catalogImportBatches.id })
      .from(catalogImportBatches)
      .where(eq(catalogImportBatches.catalogName, "production-catalog"))
      .orderBy(desc(catalogImportBatches.importedAt))
      .limit(1);
    if (latestBatch !== undefined) {
      const previousIdentities = await transaction
        .select({
          externalRecordId: catalogImportRecords.externalRecordId,
          productSlug: products.slug,
          routeSlug: productRoutes.slug
        })
        .from(catalogImportRecords)
        .innerJoin(products, eq(catalogImportRecords.productId, products.id))
        .innerJoin(productRoutes, eq(catalogImportRecords.routeId, productRoutes.id))
        .where(eq(catalogImportRecords.batchId, latestBatch.id));
      const expectedIdentities = new Map(plan.records.map((record) => [record.id, record.slug]));
      const identitySetMatches =
        previousIdentities.length === expectedIdentities.size &&
        previousIdentities.every(
          (identity) =>
            expectedIdentities.get(identity.externalRecordId) === identity.productSlug &&
            identity.productSlug === identity.routeSlug
        );
      if (!identitySetMatches) {
        throw new Error(
          "Catalog identity set or slug changed; use the explicit retirement and replacement workflow"
        );
      }
    }

    const [existingBatch] = await transaction
      .select({ id: catalogImportBatches.id })
      .from(catalogImportBatches)
      .where(eq(catalogImportBatches.payloadSha256, plan.payloadSha256))
      .limit(1);
    const batch =
      existingBatch ??
      (
        await transaction
          .insert(catalogImportBatches)
          .values({
            catalogName: "production-catalog",
            catalogSchemaVersion: "1.0.0",
            correlationId,
            draftCount: plan.draftCount,
            gatedCount: plan.gatedCount,
            importerVersion: IMPORTER_VERSION,
            payloadSha256: plan.payloadSha256,
            publishedCount: plan.publishedCount,
            recordCount: plan.recordCount,
            verifiedAt: plan.verifiedAt
          })
          .returning({ id: catalogImportBatches.id })
      )[0];
    if (batch === undefined) throw new Error("Catalog import batch was not created");

    const categoryRows = await transaction
      .select({ code: productCategories.code, id: productCategories.id })
      .from(productCategories);
    const categoryIds = new Map(categoryRows.map((row) => [row.code, row.id]));
    const yieldSourceRows = await transaction
      .select({ id: yieldSources.id, sourceClass: yieldSources.sourceClass })
      .from(yieldSources);
    const yieldSourceIds = new Map(yieldSourceRows.map((row) => [row.sourceClass, row.id]));
    const sourceIds = new Map<string, string>();
    const issuerIds = new Map<string, string>();
    const protocolIds = new Map<string, string>();
    const chainIds = new Map<string, string>();
    const assetIds = new Map<string, string>();

    const sourceVerifiedAt = new Map<string, Date>();
    for (const record of plan.records) {
      const recordVerifiedAt = new Date(record.sourceVerifiedAt);
      const current = sourceVerifiedAt.get(record.source.id);
      if (current === undefined || recordVerifiedAt > current) {
        sourceVerifiedAt.set(record.source.id, recordVerifiedAt);
      }
    }

    const ensureSource = async (record: ProductionCatalogRecord): Promise<string> => {
      const sourceCode = `CATALOG-${record.source.id}`;
      const reviewedAt = sourceVerifiedAt.get(record.source.id);
      if (reviewedAt === undefined) {
        throw new Error(`Source ${sourceCode} has no verification timestamp`);
      }
      const cached = sourceIds.get(sourceCode);
      if (cached !== undefined) return cached;
      const versions = await transaction
        .select({
          archivedAt: sourceRegistry.archivedAt,
          canonicalUrl: sourceRegistry.canonicalUrl,
          id: sourceRegistry.id,
          logicalId: sourceRegistry.logicalId,
          name: sourceRegistry.name,
          publicationStatus: sourceRegistry.publicationStatus,
          publishedAt: sourceRegistry.publishedAt,
          reviewedAt: sourceRegistry.reviewedAt,
          sourceType: sourceRegistry.sourceType,
          status: sourceRegistry.status,
          version: sourceRegistry.version
        })
        .from(sourceRegistry)
        .where(eq(sourceRegistry.code, sourceCode))
        .orderBy(desc(sourceRegistry.version))
        .limit(100);
      const latest = versions[0];
      const currentPublished = versions.find(
        (source) => source.publicationStatus === "PUBLISHED" && source.status === "ACTIVE"
      );
      if (
        currentPublished !== undefined &&
        currentPublished.archivedAt === null &&
        currentPublished.canonicalUrl === record.source.url &&
        currentPublished.name === record.source.name &&
        currentPublished.sourceType === sourceTypeMap[record.source.type] &&
        currentPublished.reviewedAt?.getTime() === reviewedAt.getTime()
      ) {
        sourceIds.set(sourceCode, currentPublished.id);
        return currentPublished.id;
      }
      if (existingBatch !== undefined) {
        throw new Error(`Catalog source ${sourceCode} drifted after its reviewed import`);
      }
      if (currentPublished !== undefined) {
        if (currentPublished.publishedAt !== null && reviewedAt <= currentPublished.publishedAt) {
          throw new Error(`Source ${sourceCode} has a non-monotonic verification cutoff`);
        }
        await transaction
          .update(sourceRegistry)
          .set({
            archivedAt: reviewedAt,
            publicationStatus: "SUPERSEDED",
            status: "REMOVED",
            updatedAt: reviewedAt
          })
          .where(
            and(
              eq(sourceRegistry.logicalId, currentPublished.logicalId),
              eq(sourceRegistry.publicationStatus, "PUBLISHED")
            )
          );
      }
      const [created] = await transaction
        .insert(sourceRegistry)
        .values({
          canonicalUrl: record.source.url,
          code: sourceCode,
          logicalId: latest?.logicalId ?? randomUUID(),
          name: record.source.name,
          ownerName: new URL(record.source.url).hostname,
          priority: 100,
          publicationStatus: "PUBLISHED",
          publishedAt: reviewedAt,
          removalProcedure:
            "Archive this source version and publish a reviewed replacement when its canonical evidence changes.",
          reviewedAt,
          sourceType: sourceTypeMap[record.source.type],
          version: (latest?.version ?? 0) + 1
        })
        .returning({ id: sourceRegistry.id });
      if (created === undefined) throw new Error(`Source ${sourceCode} was not created`);
      sourceIds.set(sourceCode, created.id);
      return created.id;
    };

    const ensureIssuer = async (name: string): Promise<string> => {
      const cached = issuerIds.get(name);
      if (cached !== undefined) return cached;
      await transaction.insert(issuers).values({ name }).onConflictDoNothing({
        target: issuers.name
      });
      const [row] = await transaction
        .select({ id: issuers.id })
        .from(issuers)
        .where(eq(issuers.name, name))
        .limit(1);
      if (row === undefined) throw new Error(`Issuer ${name} could not be resolved`);
      issuerIds.set(name, row.id);
      return row.id;
    };

    const ensureProtocol = async (name: string): Promise<string> => {
      const cached = protocolIds.get(name);
      if (cached !== undefined) return cached;
      await transaction.insert(protocols).values({ name }).onConflictDoNothing({
        target: protocols.name
      });
      const [row] = await transaction
        .select({ id: protocols.id })
        .from(protocols)
        .where(eq(protocols.name, name))
        .limit(1);
      if (row === undefined) throw new Error(`Protocol ${name} could not be resolved`);
      protocolIds.set(name, row.id);
      return row.id;
    };

    const ensureChain = async (label: string, caip2Id: string): Promise<string> => {
      const cached = chainIds.get(caip2Id);
      if (cached !== undefined) return cached;
      await transaction
        .insert(chains)
        .values({ caip2Id, name: label })
        .onConflictDoNothing({ target: chains.caip2Id });
      const [row] = await transaction
        .select({ id: chains.id })
        .from(chains)
        .where(eq(chains.caip2Id, caip2Id))
        .limit(1);
      if (row === undefined) throw new Error(`Chain ${caip2Id} could not be resolved`);
      chainIds.set(caip2Id, row.id);
      return row.id;
    };

    const ensureAsset = async (record: ProductionCatalogRecord): Promise<string> => {
      const symbol = record.symbol.toUpperCase();
      const key = `${record.category}:${symbol}`;
      const cached = assetIds.get(key);
      if (cached !== undefined) return cached;
      await transaction
        .insert(assets)
        .values({
          assetType: record.category,
          name: record.productName,
          symbol
        })
        .onConflictDoNothing({ target: [assets.symbol, assets.assetType] });
      const [row] = await transaction
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.symbol, symbol), eq(assets.assetType, record.category)))
        .limit(1);
      if (row === undefined) throw new Error(`Asset ${key} could not be resolved`);
      assetIds.set(key, row.id);
      return row.id;
    };

    for (const record of plan.records) {
      if (record.publicationStatus === "ARCHIVED") {
        throw new Error(`Archived catalog record ${record.id} cannot enter a live import`);
      }
      const recordVerifiedAt = new Date(record.verifiedAt);
      const recordSha256 = hashJson(record);
      const categoryId = categoryIds.get(record.category);
      const yieldSourceId = yieldSourceIds.get(record.yieldSource);
      if (categoryId === undefined || yieldSourceId === undefined) {
        throw new Error(`Canonical references are missing for ${record.id}`);
      }
      const sourceId = await ensureSource(record);
      const issuerId = await ensureIssuer(record.issuer);
      const protocolId = record.protocol === null ? null : await ensureProtocol(record.protocol);
      const caip2Id = caip2IdForCatalogChain(record.chain);
      const chainId = caip2Id === null ? null : await ensureChain(record.chain, caip2Id);
      const primaryAssetId = await ensureAsset(record);
      const catalogPublicationStatus = record.publicationStatus;
      const entityPublicationStatus =
        catalogPublicationStatus === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
      const expectedPublishedAt = entityPublicationStatus === "PUBLISHED" ? recordVerifiedAt : null;
      const productDescription =
        "Source-verified catalog identity. Live metrics are admitted separately as timestamped observations.";

      const [latestProduct] = await transaction
        .select({
          archivedAt: products.archivedAt,
          categoryId: products.categoryId,
          description: products.description,
          effectiveFrom: products.effectiveFrom,
          effectiveTo: products.effectiveTo,
          id: products.id,
          issuerId: products.issuerId,
          lifecycleStatus: products.lifecycleStatus,
          logicalId: products.logicalId,
          name: products.name,
          primaryAssetId: products.primaryAssetId,
          publicationStatus: products.publicationStatus,
          publishedAt: products.publishedAt,
          symbol: products.symbol,
          verifiedAt: products.verifiedAt,
          version: products.version
        })
        .from(products)
        .where(eq(products.slug, record.slug))
        .orderBy(desc(products.version))
        .limit(1);
      const productMatches =
        latestProduct !== undefined &&
        latestProduct.archivedAt === null &&
        latestProduct.effectiveTo === null &&
        latestProduct.categoryId === categoryId &&
        latestProduct.description === productDescription &&
        latestProduct.issuerId === issuerId &&
        latestProduct.lifecycleStatus === "ACTIVE" &&
        latestProduct.name === record.productName &&
        latestProduct.primaryAssetId === primaryAssetId &&
        latestProduct.publicationStatus === entityPublicationStatus &&
        latestProduct.publishedAt?.getTime() === expectedPublishedAt?.getTime() &&
        latestProduct.symbol === record.symbol.toUpperCase() &&
        latestProduct.verifiedAt?.getTime() === recordVerifiedAt.getTime();
      let product: Readonly<{ id: string }>;
      if (productMatches) {
        product = { id: latestProduct.id };
      } else {
        if (existingBatch !== undefined) {
          throw new Error(`Catalog product ${record.slug} drifted after its reviewed import`);
        }
        if (latestProduct !== undefined && recordVerifiedAt <= latestProduct.effectiveFrom) {
          throw new Error(`Catalog product ${record.slug} has a non-monotonic cutoff`);
        }
        if (latestProduct?.effectiveTo === null) {
          await transaction
            .update(products)
            .set({
              effectiveTo: recordVerifiedAt,
              publicationStatus: "SUPERSEDED",
              updatedAt: recordVerifiedAt
            })
            .where(and(eq(products.id, latestProduct.id), isNull(products.effectiveTo)));
        }
        const [createdProduct] = await transaction
          .insert(products)
          .values({
            categoryId,
            description: productDescription,
            effectiveFrom: recordVerifiedAt,
            issuerId,
            logicalId: latestProduct?.logicalId ?? randomUUID(),
            name: record.productName,
            primaryAssetId,
            publicationStatus: entityPublicationStatus,
            publishedAt: expectedPublishedAt,
            slug: record.slug,
            symbol: record.symbol.toUpperCase(),
            verifiedAt: recordVerifiedAt,
            version: (latestProduct?.version ?? 0) + 1
          })
          .returning({ id: products.id });
        if (createdProduct === undefined) throw new Error(`Product ${record.slug} was not created`);
        product = createdProduct;
      }

      const [latestRoute] = await transaction
        .select({
          accessMethod: productRoutes.accessMethod,
          archivedAt: productRoutes.archivedAt,
          chainId: productRoutes.chainId,
          depositAssetId: productRoutes.depositAssetId,
          effectiveFrom: productRoutes.effectiveFrom,
          effectiveTo: productRoutes.effectiveTo,
          id: productRoutes.id,
          isNative: productRoutes.isNative,
          lifecycleStatus: productRoutes.lifecycleStatus,
          logicalId: productRoutes.logicalId,
          name: productRoutes.name,
          productId: productRoutes.productId,
          protocolId: productRoutes.protocolId,
          publicationStatus: productRoutes.publicationStatus,
          publishedAt: productRoutes.publishedAt,
          requiresKyc: productRoutes.requiresKyc,
          verifiedAt: productRoutes.verifiedAt,
          version: productRoutes.version
        })
        .from(productRoutes)
        .where(eq(productRoutes.slug, record.slug))
        .orderBy(desc(productRoutes.version))
        .limit(1);
      const activeYieldSources =
        latestRoute === undefined
          ? []
          : await transaction
              .select({ yieldSourceId: productYieldSources.yieldSourceId })
              .from(productYieldSources)
              .where(
                and(
                  eq(productYieldSources.routeId, latestRoute.id),
                  isNull(productYieldSources.effectiveTo)
                )
              );
      const accessMethod = accessMethodMap[record.category];
      const expectedDepositAssetId = accessMethod === "NATIVE_HOLD" ? primaryAssetId : null;
      const routeMatches =
        latestRoute !== undefined &&
        latestRoute.archivedAt === null &&
        latestRoute.effectiveTo === null &&
        latestRoute.accessMethod === accessMethod &&
        latestRoute.chainId === chainId &&
        latestRoute.depositAssetId === expectedDepositAssetId &&
        latestRoute.isNative === (accessMethod === "NATIVE_HOLD") &&
        latestRoute.lifecycleStatus === "ACTIVE" &&
        latestRoute.name === record.routeName &&
        latestRoute.productId === product.id &&
        latestRoute.protocolId === protocolId &&
        latestRoute.publicationStatus === entityPublicationStatus &&
        latestRoute.publishedAt?.getTime() === expectedPublishedAt?.getTime() &&
        latestRoute.requiresKyc === record.kycRequired &&
        latestRoute.verifiedAt?.getTime() === recordVerifiedAt.getTime() &&
        activeYieldSources.length === 1 &&
        activeYieldSources[0]?.yieldSourceId === yieldSourceId;
      let route: Readonly<{ id: string }>;
      if (routeMatches) {
        route = { id: latestRoute.id };
      } else {
        if (existingBatch !== undefined) {
          throw new Error(`Catalog route ${record.slug} drifted after its reviewed import`);
        }
        if (latestRoute !== undefined && recordVerifiedAt <= latestRoute.effectiveFrom) {
          throw new Error(`Catalog route ${record.slug} has a non-monotonic cutoff`);
        }
        if (latestRoute?.effectiveTo === null) {
          await transaction
            .update(productRoutes)
            .set({
              effectiveTo: recordVerifiedAt,
              publicationStatus: "SUPERSEDED",
              updatedAt: recordVerifiedAt
            })
            .where(and(eq(productRoutes.id, latestRoute.id), isNull(productRoutes.effectiveTo)));
          await transaction
            .update(productYieldSources)
            .set({ effectiveTo: recordVerifiedAt })
            .where(
              and(
                eq(productYieldSources.routeId, latestRoute.id),
                isNull(productYieldSources.effectiveTo)
              )
            );
        }
        const [createdRoute] = await transaction
          .insert(productRoutes)
          .values({
            accessMethod,
            chainId,
            depositAssetId: expectedDepositAssetId,
            effectiveFrom: recordVerifiedAt,
            isNative: accessMethod === "NATIVE_HOLD",
            logicalId: latestRoute?.logicalId ?? randomUUID(),
            name: record.routeName,
            productId: product.id,
            protocolId,
            publicationStatus: entityPublicationStatus,
            publishedAt: expectedPublishedAt,
            requiresKyc: record.kycRequired,
            slug: record.slug,
            verifiedAt: recordVerifiedAt,
            version: (latestRoute?.version ?? 0) + 1
          })
          .returning({ id: productRoutes.id });
        if (createdRoute === undefined) throw new Error(`Route ${record.slug} was not created`);
        route = createdRoute;

        await transaction.insert(productYieldSources).values({
          effectiveFrom: recordVerifiedAt,
          routeId: route.id,
          yieldSourceId
        });
      }
      if (existingBatch === undefined) {
        await transaction.insert(catalogImportRecords).values({
          accessMethodDescription: record.accessMethod,
          batchId: batch.id,
          chainLabel: record.chain,
          confidence: record.confidence,
          discoveryStatus: record.status,
          eligibilitySummary: record.eligibilitySummary,
          externalRecordId: record.id,
          productId: product.id,
          publicationStatus: catalogPublicationStatus,
          recordSha256,
          redemptionSummary: record.redemptionSummary,
          routeId: route.id,
          sourceId,
          underlyingAsset: record.underlyingAsset,
          verifiedAt: recordVerifiedAt,
          warnings: [...record.warnings]
        });
      }
    }

    return {
      batchId: batch.id,
      gatedRecords: plan.gatedCount,
      outcome: existingBatch === undefined ? "IMPORTED" : "DUPLICATE",
      payloadSha256: plan.payloadSha256,
      publishedRecords: plan.publishedCount,
      recordsImported: existingBatch === undefined ? plan.recordCount : 0
    };
  });
};

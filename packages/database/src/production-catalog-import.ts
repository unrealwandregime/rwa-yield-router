import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  productionCatalog,
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

const IMPORTER_VERSION = "production-catalog-import-v1.0.0";
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
  const report = validateProductionCatalog(records);
  if (report.gated + report.published !== report.total) {
    throw new Error("Production import accepts only gated or published catalog records");
  }
  const verifiedAtValues = new Set(records.map((record) => record.verifiedAt));
  if (verifiedAtValues.size !== 1) {
    throw new Error("A catalog import batch must use one verification cutoff");
  }
  const verifiedAtValue = records[0]?.verifiedAt;
  if (verifiedAtValue === undefined) {
    throw new Error("A production catalog import cannot be empty");
  }
  const canonicalRecords = canonicalCatalogPayload(records);
  return {
    draftCount: 0,
    gatedCount: report.gated,
    payloadSha256: hashJson(canonicalRecords),
    publishedCount: report.published,
    recordCount: report.total,
    records: canonicalRecords,
    verifiedAt: new Date(verifiedAtValue)
  };
};

export const importProductionCatalog = async (
  database: Database,
  input: Readonly<{
    correlationId?: string;
    records?: ReadonlyArray<ProductionCatalogRecord>;
  }> = {}
): Promise<ProductionCatalogImportResult> => {
  await seedCanonicalReferenceData(database);
  const plan = buildProductionCatalogImportPlan(input.records ?? productionCatalog);
  const correlationId = input.correlationId ?? randomUUID();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${IMPORT_LOCK_KEY}))`);

    const [existingBatch] = await transaction
      .select({ id: catalogImportBatches.id })
      .from(catalogImportBatches)
      .where(eq(catalogImportBatches.payloadSha256, plan.payloadSha256))
      .limit(1);
    if (existingBatch !== undefined) {
      return {
        batchId: existingBatch.id,
        gatedRecords: plan.gatedCount,
        outcome: "DUPLICATE",
        payloadSha256: plan.payloadSha256,
        publishedRecords: plan.publishedCount,
        recordsImported: 0
      };
    }

    const [batch] = await transaction
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
      .returning({ id: catalogImportBatches.id });
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

    const ensureSource = async (record: ProductionCatalogRecord): Promise<string> => {
      const sourceCode = `CATALOG-${record.source.id}`;
      const cached = sourceIds.get(sourceCode);
      if (cached !== undefined) return cached;
      const versions = await transaction
        .select({
          canonicalUrl: sourceRegistry.canonicalUrl,
          id: sourceRegistry.id,
          logicalId: sourceRegistry.logicalId,
          name: sourceRegistry.name,
          publicationStatus: sourceRegistry.publicationStatus,
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
        currentPublished.canonicalUrl === record.source.url &&
        currentPublished.name === record.source.name
      ) {
        sourceIds.set(sourceCode, currentPublished.id);
        return currentPublished.id;
      }
      if (currentPublished !== undefined) {
        await transaction
          .update(sourceRegistry)
          .set({
            archivedAt: plan.verifiedAt,
            publicationStatus: "SUPERSEDED",
            status: "REMOVED",
            updatedAt: plan.verifiedAt
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
          publishedAt: plan.verifiedAt,
          removalProcedure:
            "Archive this source version and publish a reviewed replacement when its canonical evidence changes.",
          reviewedAt: plan.verifiedAt,
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

      const [latestProduct] = await transaction
        .select({
          effectiveFrom: products.effectiveFrom,
          effectiveTo: products.effectiveTo,
          id: products.id,
          logicalId: products.logicalId,
          version: products.version
        })
        .from(products)
        .where(eq(products.slug, record.slug))
        .orderBy(desc(products.version))
        .limit(1);
      if (latestProduct?.effectiveTo === null) {
        if (plan.verifiedAt <= latestProduct.effectiveFrom) {
          throw new Error(`Catalog product ${record.slug} has a non-monotonic cutoff`);
        }
        await transaction
          .update(products)
          .set({
            effectiveTo: plan.verifiedAt,
            publicationStatus: "SUPERSEDED",
            updatedAt: plan.verifiedAt
          })
          .where(and(eq(products.id, latestProduct.id), isNull(products.effectiveTo)));
      }
      const [product] = await transaction
        .insert(products)
        .values({
          categoryId,
          description:
            "Source-verified catalog identity. Live metrics are admitted separately as timestamped observations.",
          effectiveFrom: plan.verifiedAt,
          issuerId,
          logicalId: latestProduct?.logicalId ?? randomUUID(),
          name: record.productName,
          primaryAssetId,
          publicationStatus: entityPublicationStatus,
          publishedAt: entityPublicationStatus === "PUBLISHED" ? plan.verifiedAt : null,
          slug: record.slug,
          symbol: record.symbol.toUpperCase(),
          verifiedAt: plan.verifiedAt,
          version: (latestProduct?.version ?? 0) + 1
        })
        .returning({ id: products.id });
      if (product === undefined) throw new Error(`Product ${record.slug} was not created`);

      const [latestRoute] = await transaction
        .select({
          effectiveFrom: productRoutes.effectiveFrom,
          effectiveTo: productRoutes.effectiveTo,
          id: productRoutes.id,
          logicalId: productRoutes.logicalId,
          version: productRoutes.version
        })
        .from(productRoutes)
        .where(eq(productRoutes.slug, record.slug))
        .orderBy(desc(productRoutes.version))
        .limit(1);
      if (latestRoute?.effectiveTo === null) {
        if (plan.verifiedAt <= latestRoute.effectiveFrom) {
          throw new Error(`Catalog route ${record.slug} has a non-monotonic cutoff`);
        }
        await transaction
          .update(productRoutes)
          .set({
            effectiveTo: plan.verifiedAt,
            publicationStatus: "SUPERSEDED",
            updatedAt: plan.verifiedAt
          })
          .where(and(eq(productRoutes.id, latestRoute.id), isNull(productRoutes.effectiveTo)));
      }
      const accessMethod = accessMethodMap[record.category];
      const [route] = await transaction
        .insert(productRoutes)
        .values({
          accessMethod,
          chainId,
          depositAssetId: accessMethod === "NATIVE_HOLD" ? primaryAssetId : null,
          effectiveFrom: plan.verifiedAt,
          isNative: accessMethod === "NATIVE_HOLD",
          logicalId: latestRoute?.logicalId ?? randomUUID(),
          name: record.routeName,
          productId: product.id,
          protocolId,
          publicationStatus: entityPublicationStatus,
          publishedAt: entityPublicationStatus === "PUBLISHED" ? plan.verifiedAt : null,
          requiresKyc: record.kycRequired,
          slug: record.slug,
          verifiedAt: plan.verifiedAt,
          version: (latestRoute?.version ?? 0) + 1
        })
        .returning({ id: productRoutes.id });
      if (route === undefined) throw new Error(`Route ${record.slug} was not created`);

      await transaction.insert(productYieldSources).values({
        effectiveFrom: plan.verifiedAt,
        routeId: route.id,
        yieldSourceId
      });
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
        recordSha256: hashJson(record),
        redemptionSummary: record.redemptionSummary,
        routeId: route.id,
        sourceId,
        underlyingAsset: record.underlyingAsset,
        verifiedAt: plan.verifiedAt,
        warnings: [...record.warnings]
      });
    }

    return {
      batchId: batch.id,
      gatedRecords: plan.gatedCount,
      outcome: "IMPORTED",
      payloadSha256: plan.payloadSha256,
      publishedRecords: plan.publishedCount,
      recordsImported: plan.recordCount
    };
  });
};

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import {
  accessMethodEnum,
  lifecycleStatusEnum,
  productCategoryCodeEnum,
  publicationStatusEnum,
  yieldSourceClassEnum
} from "./enums.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    isoCode: varchar("iso_code", { length: 3 }).notNull(),
    name: text("name").notNull(),
    subdivisionCode: varchar("subdivision_code", { length: 8 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("jurisdictions_iso_subdivision_unique").on(table.isoCode, table.subdivisionCode),
    check("jurisdictions_iso_code_uppercase", sql`${table.isoCode} = upper(${table.isoCode})`),
    check("jurisdictions_name_not_blank", sql`btrim(${table.name}) <> ''`)
  ]
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    name: text("name").notNull(),
    assetType: varchar("asset_type", { length: 64 }).notNull(),
    currencyCode: varchar("currency_code", { length: 8 }),
    decimals: integer("decimals"),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("assets_symbol_type_unique").on(table.symbol, table.assetType),
    check("assets_symbol_not_blank", sql`btrim(${table.symbol}) <> ''`),
    check(
      "assets_decimals_range",
      sql`${table.decimals} is null or (${table.decimals} >= 0 and ${table.decimals} <= 255)`
    )
  ]
);

export const stablecoins = pgTable(
  "stablecoins",
  {
    assetId: uuid("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    pegAssetId: uuid("peg_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    pegCurrencyCode: varchar("peg_currency_code", { length: 8 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    check(
      "stablecoins_exactly_one_peg",
      sql`num_nonnulls(${table.pegAssetId}, ${table.pegCurrencyCode}) = 1`
    )
  ]
);

export const chains = pgTable(
  "chains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caip2Id: varchar("caip2_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    nativeAssetId: uuid("native_asset_id").references(() => assets.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    explorerBaseUrl: text("explorer_base_url"),
    finalityBlocks: integer("finality_blocks"),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("chains_caip2_id_unique").on(table.caip2Id),
    check("chains_caip2_not_blank", sql`btrim(${table.caip2Id}) <> ''`),
    check(
      "chains_explorer_https",
      sql`${table.explorerBaseUrl} is null or ${table.explorerBaseUrl} ~ '^https://'`
    ),
    check(
      "chains_finality_nonnegative",
      sql`${table.finalityBlocks} is null or ${table.finalityBlocks} >= 0`
    )
  ]
);

const organizationColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  officialUrl: text("official_url"),
  jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id, {
    onDelete: "set null",
    onUpdate: "cascade"
  }),
  lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
  createdAt: utcTimestamp("created_at").notNull().defaultNow(),
  updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
  archivedAt: utcTimestamp("archived_at")
});

export const issuers = pgTable("issuers", organizationColumns(), (table) => [
  unique("issuers_name_unique").on(table.name),
  check("issuers_name_not_blank", sql`btrim(${table.name}) <> ''`),
  check(
    "issuers_official_url_https",
    sql`${table.officialUrl} is null or ${table.officialUrl} ~ '^https://'`
  )
]);

export const protocols = pgTable("protocols", organizationColumns(), (table) => [
  unique("protocols_name_unique").on(table.name),
  check("protocols_name_not_blank", sql`btrim(${table.name}) <> ''`),
  check(
    "protocols_official_url_https",
    sql`${table.officialUrl} is null or ${table.officialUrl} ~ '^https://'`
  )
]);

export const custodians = pgTable("custodians", organizationColumns(), (table) => [
  unique("custodians_name_unique").on(table.name),
  check("custodians_name_not_blank", sql`btrim(${table.name}) <> ''`)
]);

export const auditors = pgTable("auditors", organizationColumns(), (table) => [
  unique("auditors_name_unique").on(table.name),
  check("auditors_name_not_blank", sql`btrim(${table.name}) <> ''`)
]);

export const oracles = pgTable("oracles", organizationColumns(), (table) => [
  unique("oracles_name_unique").on(table.name),
  check("oracles_name_not_blank", sql`btrim(${table.name}) <> ''`)
]);

export const productCategories = pgTable(
  "product_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: productCategoryCodeEnum("code").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [unique("product_categories_code_unique").on(table.code)]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalId: uuid("logical_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => productCategories.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    primaryAssetId: uuid("primary_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    issuerId: uuid("issuer_id").references(() => issuers.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: text("name").notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    description: text("description"),
    denominationAssetId: uuid("denomination_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
    publicationStatus: publicationStatusEnum("publication_status").notNull().default("DRAFT"),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    verifiedAt: utcTimestamp("verified_at"),
    publishedAt: utcTimestamp("published_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("products_logical_version_unique").on(table.logicalId, table.version),
    unique("products_slug_version_unique").on(table.slug, table.version),
    uniqueIndex("products_current_slug_unique")
      .on(table.slug)
      .where(sql`${table.effectiveTo} is null`),
    index("products_category_status_idx").on(
      table.categoryId,
      table.publicationStatus,
      table.lifecycleStatus
    ),
    index("products_issuer_idx").on(table.issuerId),
    check("products_version_positive", sql`${table.version} > 0`),
    check("products_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("products_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("products_symbol_not_blank", sql`btrim(${table.symbol}) <> ''`),
    check(
      "products_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    ),
    check(
      "products_published_timestamp",
      sql`${table.publicationStatus} <> 'PUBLISHED' or ${table.publishedAt} is not null`
    )
  ]
);

export const productRoutes = pgTable(
  "product_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalId: uuid("logical_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),
    protocolId: uuid("protocol_id").references(() => protocols.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    chainId: uuid("chain_id").references(() => chains.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    depositAssetId: uuid("deposit_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    receiptAssetId: uuid("receipt_asset_id").references(() => assets.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: text("name").notNull(),
    accessMethod: accessMethodEnum("access_method").notNull(),
    isNative: boolean("is_native").notNull().default(false),
    requiresKyc: boolean("requires_kyc"),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
    publicationStatus: publicationStatusEnum("publication_status").notNull().default("DRAFT"),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    verifiedAt: utcTimestamp("verified_at"),
    publishedAt: utcTimestamp("published_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("product_routes_logical_version_unique").on(table.logicalId, table.version),
    unique("product_routes_id_product_unique").on(table.id, table.productId),
    unique("product_routes_slug_version_unique").on(table.slug, table.version),
    uniqueIndex("product_routes_current_slug_unique")
      .on(table.slug)
      .where(sql`${table.effectiveTo} is null`),
    index("product_routes_product_status_idx").on(
      table.productId,
      table.publicationStatus,
      table.lifecycleStatus
    ),
    index("product_routes_protocol_chain_idx").on(table.protocolId, table.chainId),
    check("product_routes_version_positive", sql`${table.version} > 0`),
    check("product_routes_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("product_routes_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "product_routes_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    ),
    check(
      "product_routes_native_method",
      sql`not ${table.isNative} or ${table.accessMethod} = 'NATIVE_HOLD'`
    )
  ]
);

export const yieldSources = pgTable(
  "yield_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceClass: yieldSourceClassEnum("source_class").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isIncentive: boolean("is_incentive").notNull().default(false),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("yield_sources_class_name_unique").on(table.sourceClass, table.name),
    check("yield_sources_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "yield_sources_no_native_not_incentive",
      sql`${table.sourceClass} <> 'NO_NATIVE_YIELD' or not ${table.isIncentive}`
    )
  ]
);

export const productYieldSources = pgTable(
  "product_yield_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    yieldSourceId: uuid("yield_source_id")
      .notNull()
      .references(() => yieldSources.id, { onDelete: "restrict", onUpdate: "cascade" }),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("product_yield_sources_product_unique").on(
      table.productId,
      table.yieldSourceId,
      table.effectiveFrom
    ),
    unique("product_yield_sources_route_unique").on(
      table.routeId,
      table.yieldSourceId,
      table.effectiveFrom
    ),
    index("product_yield_sources_product_idx").on(table.productId),
    index("product_yield_sources_route_idx").on(table.routeId),
    check(
      "product_yield_sources_exactly_one_parent",
      sql`num_nonnulls(${table.productId}, ${table.routeId}) = 1`
    ),
    check(
      "product_yield_sources_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    )
  ]
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "restrict", onUpdate: "cascade" }),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    contractType: varchar("contract_type", { length: 64 }).notNull(),
    explorerUrl: text("explorer_url"),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: utcTimestamp("verified_at"),
    deploymentBlock: numeric("deployment_block", { precision: 78, scale: 0 }),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("ACTIVE"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    archivedAt: utcTimestamp("archived_at")
  },
  (table) => [
    unique("contracts_chain_address_unique").on(table.chainId, table.normalizedAddress),
    check("contracts_address_not_blank", sql`btrim(${table.address}) <> ''`),
    check(
      "contracts_verified_timestamp",
      sql`not ${table.isVerified} or ${table.verifiedAt} is not null`
    ),
    check(
      "contracts_deployment_block_nonnegative",
      sql`${table.deploymentBlock} is null or ${table.deploymentBlock} >= 0`
    )
  ]
);

export const productContracts = pgTable(
  "product_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),
    routeId: uuid("route_id").references(() => productRoutes.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict", onUpdate: "cascade" }),
    relationshipType: varchar("relationship_type", { length: 64 }).notNull(),
    effectiveFrom: utcTimestamp("effective_from").notNull(),
    effectiveTo: utcTimestamp("effective_to"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("product_contracts_product_unique")
      .on(table.productId, table.contractId, table.relationshipType, table.effectiveFrom)
      .where(sql`${table.routeId} is null`),
    uniqueIndex("product_contracts_route_unique")
      .on(table.routeId, table.contractId, table.relationshipType, table.effectiveFrom)
      .where(sql`${table.routeId} is not null`),
    foreignKey({
      columns: [table.routeId, table.productId],
      foreignColumns: [productRoutes.id, productRoutes.productId],
      name: "product_contracts_route_product_fk"
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("product_contracts_route_idx").on(table.routeId),
    check("product_contracts_relationship_not_blank", sql`btrim(${table.relationshipType}) <> ''`),
    check(
      "product_contracts_effective_interval",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`
    )
  ]
);

export const returnExposures = pgTable(
  "return_exposures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 64 }).notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [unique("return_exposures_code_unique").on(table.code)]
);

export const productReturnExposures = pgTable(
  "product_return_exposures",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),
    returnExposureId: uuid("return_exposure_id")
      .notNull()
      .references(() => returnExposures.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.productId, table.returnExposureId],
      name: "product_return_exposures_pk"
    })
  ]
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductRoute = typeof productRoutes.$inferSelect;
export type NewProductRoute = typeof productRoutes.$inferInsert;

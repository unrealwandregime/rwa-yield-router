import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { productRoutes, products } from "./catalog.js";
import {
  catalogImportPublicationStatusEnum,
  catalogDiscoveryStatusEnum,
  confidenceClassEnum
} from "./enums.js";
import { sourceRegistry } from "./provenance.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const catalogImportBatches = pgTable(
  "catalog_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogName: varchar("catalog_name", { length: 128 }).notNull(),
    catalogSchemaVersion: varchar("catalog_schema_version", { length: 32 }).notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    recordCount: integer("record_count").notNull(),
    draftCount: integer("draft_count").notNull(),
    gatedCount: integer("gated_count").notNull(),
    publishedCount: integer("published_count").notNull(),
    verifiedAt: utcTimestamp("verified_at").notNull(),
    importerVersion: varchar("importer_version", { length: 64 }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    importedAt: utcTimestamp("imported_at").notNull().defaultNow()
  },
  (table) => [
    unique("catalog_import_batches_payload_hash_unique").on(table.payloadSha256),
    index("catalog_import_batches_imported_at_idx").on(table.importedAt),
    check("catalog_import_batches_name_not_blank", sql`btrim(${table.catalogName}) <> ''`),
    check(
      "catalog_import_batches_schema_version_not_blank",
      sql`btrim(${table.catalogSchemaVersion}) <> ''`
    ),
    check(
      "catalog_import_batches_counts",
      sql`${table.recordCount} > 0 and ${table.draftCount} >= 0 and ${table.gatedCount} >= 0 and ${table.publishedCount} >= 0 and ${table.recordCount} = ${table.draftCount} + ${table.gatedCount} + ${table.publishedCount}`
    ),
    check("catalog_import_batches_hash_format", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const catalogImportRecords = pgTable(
  "catalog_import_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => catalogImportBatches.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    externalRecordId: varchar("external_record_id", { length: 32 }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => productRoutes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sourceRegistry.id, { onDelete: "restrict", onUpdate: "cascade" }),
    discoveryStatus: catalogDiscoveryStatusEnum("discovery_status").notNull(),
    publicationStatus: catalogImportPublicationStatusEnum("publication_status").notNull(),
    confidence: confidenceClassEnum("confidence").notNull(),
    chainLabel: varchar("chain_label", { length: 80 }).notNull(),
    underlyingAsset: varchar("underlying_asset", { length: 120 }).notNull(),
    accessMethodDescription: text("access_method_description").notNull(),
    eligibilitySummary: text("eligibility_summary").notNull(),
    redemptionSummary: text("redemption_summary").notNull(),
    warnings: jsonb("warnings").notNull(),
    verifiedAt: utcTimestamp("verified_at").notNull(),
    recordSha256: varchar("record_sha256", { length: 64 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("catalog_import_records_batch_external_unique").on(
      table.batchId,
      table.externalRecordId
    ),
    unique("catalog_import_records_batch_route_unique").on(table.batchId, table.routeId),
    index("catalog_import_records_publication_idx").on(
      table.publicationStatus,
      table.discoveryStatus
    ),
    index("catalog_import_records_product_idx").on(table.productId),
    check(
      "catalog_import_records_publication_semantics",
      sql`${table.publicationStatus} <> 'PUBLISHED' or ${table.discoveryStatus} = 'IDENTITY_CONFIRMED'`
    ),
    check(
      "catalog_import_records_admission_gate",
      sql`${table.discoveryStatus} <> 'ADMISSION_GATED' or ${table.publicationStatus} in ('DRAFT', 'GATED')`
    ),
    check("catalog_import_records_warnings_array", sql`jsonb_typeof(${table.warnings}) = 'array'`),
    check("catalog_import_records_hash_format", sql`${table.recordSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "catalog_import_records_text_not_blank",
      sql`btrim(${table.chainLabel}) <> '' and btrim(${table.underlyingAsset}) <> '' and btrim(${table.accessMethodDescription}) <> '' and btrim(${table.eligibilitySummary}) <> '' and btrim(${table.redemptionSummary}) <> ''`
    )
  ]
);

export type CatalogImportBatch = typeof catalogImportBatches.$inferSelect;
export type CatalogImportRecord = typeof catalogImportRecords.$inferSelect;

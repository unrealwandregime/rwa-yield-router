CREATE TYPE "public"."catalog_discovery_status" AS ENUM('IDENTITY_CONFIRMED', 'SOURCE_CONFIRMED', 'ADMISSION_GATED');--> statement-breakpoint
CREATE TYPE "public"."catalog_import_publication_status" AS ENUM('DRAFT', 'GATED', 'PUBLISHED');--> statement-breakpoint
CREATE TABLE "catalog_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_name" varchar(128) NOT NULL,
	"catalog_schema_version" varchar(32) NOT NULL,
	"payload_sha256" varchar(64) NOT NULL,
	"record_count" integer NOT NULL,
	"draft_count" integer NOT NULL,
	"gated_count" integer NOT NULL,
	"published_count" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"importer_version" varchar(64) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_import_batches_payload_hash_unique" UNIQUE("payload_sha256"),
	CONSTRAINT "catalog_import_batches_name_not_blank" CHECK (btrim("catalog_import_batches"."catalog_name") <> ''),
	CONSTRAINT "catalog_import_batches_schema_version_not_blank" CHECK (btrim("catalog_import_batches"."catalog_schema_version") <> ''),
	CONSTRAINT "catalog_import_batches_counts" CHECK ("catalog_import_batches"."record_count" > 0 and "catalog_import_batches"."draft_count" >= 0 and "catalog_import_batches"."gated_count" >= 0 and "catalog_import_batches"."published_count" >= 0 and "catalog_import_batches"."record_count" = "catalog_import_batches"."draft_count" + "catalog_import_batches"."gated_count" + "catalog_import_batches"."published_count"),
	CONSTRAINT "catalog_import_batches_hash_format" CHECK ("catalog_import_batches"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "catalog_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"external_record_id" varchar(32) NOT NULL,
	"product_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"discovery_status" "catalog_discovery_status" NOT NULL,
	"publication_status" "catalog_import_publication_status" NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"chain_label" varchar(80) NOT NULL,
	"underlying_asset" varchar(120) NOT NULL,
	"access_method_description" text NOT NULL,
	"eligibility_summary" text NOT NULL,
	"redemption_summary" text NOT NULL,
	"warnings" jsonb NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"record_sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_import_records_batch_external_unique" UNIQUE("batch_id","external_record_id"),
	CONSTRAINT "catalog_import_records_batch_route_unique" UNIQUE("batch_id","route_id"),
	CONSTRAINT "catalog_import_records_publication_semantics" CHECK ("catalog_import_records"."publication_status" <> 'PUBLISHED' or "catalog_import_records"."discovery_status" = 'IDENTITY_CONFIRMED'),
	CONSTRAINT "catalog_import_records_admission_gate" CHECK ("catalog_import_records"."discovery_status" <> 'ADMISSION_GATED' or "catalog_import_records"."publication_status" in ('DRAFT', 'GATED')),
	CONSTRAINT "catalog_import_records_warnings_array" CHECK (jsonb_typeof("catalog_import_records"."warnings") = 'array'),
	CONSTRAINT "catalog_import_records_hash_format" CHECK ("catalog_import_records"."record_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "catalog_import_records_text_not_blank" CHECK (btrim("catalog_import_records"."chain_label") <> '' and btrim("catalog_import_records"."underlying_asset") <> '' and btrim("catalog_import_records"."access_method_description") <> '' and btrim("catalog_import_records"."eligibility_summary") <> '' and btrim("catalog_import_records"."redemption_summary") <> '')
);
--> statement-breakpoint
ALTER TABLE "catalog_import_records" ADD CONSTRAINT "catalog_import_records_batch_id_catalog_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."catalog_import_batches"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "catalog_import_records" ADD CONSTRAINT "catalog_import_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "catalog_import_records" ADD CONSTRAINT "catalog_import_records_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "catalog_import_records" ADD CONSTRAINT "catalog_import_records_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "catalog_import_batches_imported_at_idx" ON "catalog_import_batches" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX "catalog_import_records_publication_idx" ON "catalog_import_records" USING btree ("publication_status","discovery_status");--> statement-breakpoint
CREATE INDEX "catalog_import_records_product_idx" ON "catalog_import_records" USING btree ("product_id");
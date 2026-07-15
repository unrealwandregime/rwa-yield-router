CREATE TYPE "public"."adapter_health_outcome" AS ENUM('SUCCEEDED', 'DEGRADED', 'FAILED');--> statement-breakpoint
ALTER TABLE "product_routes" DROP CONSTRAINT "product_routes_slug_unique";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_slug_unique";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_revocation_reason_present";--> statement-breakpoint
ALTER TABLE "adapter_health" DROP CONSTRAINT "adapter_health_success_timestamp";--> statement-breakpoint
ALTER TABLE "product_contracts" DROP CONSTRAINT "product_contracts_pk";--> statement-breakpoint
ALTER TABLE "product_yield_sources" DROP CONSTRAINT "product_yield_sources_pk";--> statement-breakpoint
ALTER TABLE "adapter_health" ALTER COLUMN "outcome" SET DATA TYPE "public"."adapter_health_outcome" USING "outcome"::text::"public"."adapter_health_outcome";--> statement-breakpoint
ALTER TABLE "product_contracts" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "redemption_terms" ADD CONSTRAINT "redemption_terms_minimum_amount_asset_id_assets_id_fk" FOREIGN KEY ("minimum_amount_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "product_contracts_product_unique" ON "product_contracts" USING btree ("product_id","contract_id","relationship_type","effective_from") WHERE "product_contracts"."route_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_contracts_route_unique" ON "product_contracts" USING btree ("route_id","contract_id","relationship_type","effective_from") WHERE "product_contracts"."route_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_routes_current_slug_unique" ON "product_routes" USING btree ("slug") WHERE "product_routes"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_current_slug_unique" ON "products" USING btree ("slug") WHERE "products"."effective_to" is null;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_slug_version_unique" UNIQUE("slug","version");--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD CONSTRAINT "product_yield_sources_product_unique" UNIQUE("product_id","yield_source_id","effective_from");--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD CONSTRAINT "product_yield_sources_route_unique" UNIQUE("route_id","yield_source_id","effective_from");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_slug_version_unique" UNIQUE("slug","version");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_revocation_reason_present" CHECK ("sessions"."revoked_at" is null or ("sessions"."revocation_reason" is not null and btrim("sessions"."revocation_reason") <> ''));--> statement-breakpoint
ALTER TABLE "adapter_health" ADD CONSTRAINT "adapter_health_success_timestamp" CHECK ("adapter_health"."outcome" <> 'SUCCEEDED' or "adapter_health"."succeeded_at" is not null);
ALTER TABLE "product_routes" ADD COLUMN "slug" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "slug" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_slug_format" CHECK ("product_routes"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_slug_format" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
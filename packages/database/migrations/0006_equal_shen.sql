CREATE TABLE "yield_history_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source_yield_snapshot_id" uuid NOT NULL,
	"net_apy" numeric(24, 18) NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"data_cutoff" timestamp with time zone NOT NULL,
	"calculation_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yield_history_rollups_route_bucket_version_unique" UNIQUE("route_id","bucket_start","calculation_version"),
	CONSTRAINT "yield_history_rollups_bucket_alignment" CHECK ("yield_history_rollups"."bucket_start" = date_trunc('day', "yield_history_rollups"."bucket_start")),
	CONSTRAINT "yield_history_rollups_time_order" CHECK ("yield_history_rollups"."as_of" >= "yield_history_rollups"."bucket_start" and "yield_history_rollups"."as_of" < "yield_history_rollups"."bucket_start" + interval '1 day' and "yield_history_rollups"."data_cutoff" >= "yield_history_rollups"."bucket_start" + interval '1 day'),
	CONSTRAINT "yield_history_rollups_available" CHECK ("yield_history_rollups"."status" = 'AVAILABLE')
);
--> statement-breakpoint
ALTER TABLE "yield_history_rollups" ADD CONSTRAINT "yield_history_rollups_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yield_history_rollups" ADD CONSTRAINT "yield_history_rollups_source_yield_snapshot_id_yield_snapshots_id_fk" FOREIGN KEY ("source_yield_snapshot_id") REFERENCES "public"."yield_snapshots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "yield_history_rollups_route_bucket_idx" ON "yield_history_rollups" USING btree ("route_id","bucket_start");--> statement-breakpoint
CREATE INDEX "yield_history_rollups_source_snapshot_idx" ON "yield_history_rollups" USING btree ("source_yield_snapshot_id");
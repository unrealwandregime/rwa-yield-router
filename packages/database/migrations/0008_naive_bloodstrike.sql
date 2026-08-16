ALTER TABLE "yield_history_rollups" DROP CONSTRAINT "yield_history_rollups_source_yield_snapshot_id_yield_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "yield_history_rollups" ADD CONSTRAINT "yield_history_rollups_snapshot_route_fk" FOREIGN KEY ("source_yield_snapshot_id","route_id") REFERENCES "public"."yield_snapshots"("id","route_id") ON DELETE restrict ON UPDATE cascade;
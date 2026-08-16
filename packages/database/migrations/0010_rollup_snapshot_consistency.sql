CREATE OR REPLACE FUNCTION validate_yield_history_rollup_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "yield_snapshots"
  WHERE "yield_snapshots"."id" = NEW."source_yield_snapshot_id"
    AND "yield_snapshots"."route_id" = NEW."route_id"
    AND "yield_snapshots"."as_of" = NEW."as_of"
    AND "yield_snapshots"."net_apy" IS NOT DISTINCT FROM NEW."net_apy"
    AND "yield_snapshots"."confidence" = NEW."confidence"
    AND "yield_snapshots"."status" = NEW."status";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'yield history rollup must exactly match its source yield snapshot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "validate_yield_history_rollup_snapshot_fields"
BEFORE INSERT OR UPDATE ON "yield_history_rollups"
FOR EACH ROW EXECUTE FUNCTION validate_yield_history_rollup_snapshot();

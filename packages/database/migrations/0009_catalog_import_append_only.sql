CREATE TRIGGER "prevent_catalog_import_batches_mutation"
BEFORE UPDATE OR DELETE ON "catalog_import_batches"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER "prevent_catalog_import_records_mutation"
BEFORE UPDATE OR DELETE ON "catalog_import_records"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

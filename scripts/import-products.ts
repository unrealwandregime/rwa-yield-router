import {
  createPublishedCatalogImportPayload,
  validateProductionCatalog
} from "@rwa-yield-router/data-adapters";

validateProductionCatalog();

// This command emits only sourced PUBLISHED metadata. Database persistence consumes this
// deterministic payload transactionally; GATED rows and live numeric metrics are absent.
process.stdout.write(JSON.stringify(createPublishedCatalogImportPayload(), null, 2) + "\n");

import { createPublishedCatalogImportPayload } from "../src/catalog.js";

process.stdout.write(JSON.stringify(createPublishedCatalogImportPayload(), null, 2) + "\n");

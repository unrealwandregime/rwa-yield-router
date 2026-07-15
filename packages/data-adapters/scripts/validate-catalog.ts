import { validateProductionCatalog } from "../src/catalog.js";

const report = validateProductionCatalog();
process.stdout.write(JSON.stringify(report, null, 2) + "\n");

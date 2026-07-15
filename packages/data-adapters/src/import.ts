import { isIP } from "node:net";

import { z } from "zod";

import {
  confidenceSchema,
  productCategorySchema,
  sourceTypeSchema,
  yieldSourceSchema
} from "./types.js";

const dangerousSpreadsheetPrefix = /^[\u0009\u000a\u000d ]*[=+\-@]/u;
const reviewStatusSchema = z.enum(["DRAFT", "IN_REVIEW", "VERIFIED", "REJECTED"]);
const safeSourceUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    isIP(url.hostname) !== 0
  ) {
    context.addIssue({ code: "custom", message: "Source URL is not an approved HTTPS hostname" });
  }
});

export const manualImportRecordSchema = z
  .object({
    stableProductSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    stableRouteSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    productName: z.string().trim().min(1).max(200),
    symbol: z.string().trim().min(1).max(32),
    routeName: z.string().trim().min(1).max(240),
    category: productCategorySchema,
    chain: z.string().trim().min(1).max(80),
    issuer: z.string().trim().min(1).max(100),
    protocol: z.string().trim().min(1).max(100).nullable().default(null),
    underlyingAsset: z.string().trim().min(1).max(120),
    yieldSource: yieldSourceSchema,
    accessMethod: z.string().trim().min(1).max(300),
    kycRequired: z.boolean().nullable(),
    eligibilitySummary: z.string().trim().min(1).max(2_000),
    redemptionSummary: z.string().trim().min(1).max(2_000),
    nativeYield: z.enum(["0"]).nullable(),
    confidence: confidenceSchema,
    sourceId: z.string().trim().min(1).max(128),
    sourceName: z.string().trim().min(1).max(200),
    sourceType: sourceTypeSchema,
    sourceUrl: safeSourceUrlSchema,
    effectiveAt: z.iso.datetime({ offset: true }),
    verifiedAt: z.iso.datetime({ offset: true }),
    reverifyAt: z.iso.datetime({ offset: true }),
    reviewStatus: reviewStatusSchema.default("DRAFT"),
    publicationStatus: z.literal("GATED").default("GATED")
  })
  .strict()
  .superRefine((record, context) => {
    if (new Date(record.reverifyAt) <= new Date(record.effectiveAt)) {
      context.addIssue({
        code: "custom",
        message: "reverifyAt must be later than effectiveAt",
        path: ["reverifyAt"]
      });
    }
    if (record.category === "GOLD_BACKED_TOKEN" || record.category === "CASH_EQUIVALENT") {
      if (record.nativeYield !== "0") {
        context.addIssue({
          code: "custom",
          message: "Native non-yield products must explicitly use zero",
          path: ["nativeYield"]
        });
      }
    } else if (record.nativeYield !== null) {
      context.addIssue({
        code: "custom",
        message: "Import cannot assert a native yield metric",
        path: ["nativeYield"]
      });
    }
  });

export const manualImportDocumentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    records: z.array(manualImportRecordSchema).min(1).max(5_000)
  })
  .strict();

export type ManualImportRecord = z.infer<typeof manualImportRecordSchema>;
export type ManualImportDocument = z.infer<typeof manualImportDocumentSchema>;

export interface ImportValidationOptions {
  readonly existingProductSlugs?: ReadonlySet<string>;
  readonly existingRouteSlugs?: ReadonlySet<string>;
  readonly allowedSourceHosts?: ReadonlySet<string>;
  readonly now?: Date;
}

function assertFormulaSafe(value: unknown, path: string): void {
  if (typeof value === "string" && dangerousSpreadsheetPrefix.test(value)) {
    throw new Error("Spreadsheet formula prefix is not allowed at " + path);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFormulaSafe(entry, path + "." + String(index)));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertFormulaSafe(entry, path + "." + key);
    }
  }
}

export function validateImportDocument(
  input: unknown,
  options: ImportValidationOptions = {}
): ManualImportDocument {
  assertFormulaSafe(input, "document");
  const document = manualImportDocumentSchema.parse(input);
  const productSlugs = new Set<string>();
  const routeSlugs = new Set<string>();
  const now = options.now ?? new Date();
  for (const record of document.records) {
    if (
      /(?:^|[-_])(test|fixture|mock|fake|lorem)(?:$|[-_])/iu.test(record.stableRouteSlug) ||
      /(?:^|[-_])(test|fixture|mock|fake|lorem)(?:$|[-_])/iu.test(record.stableProductSlug)
    ) {
      throw new Error("Production imports reject fixture markers");
    }
    if (
      routeSlugs.has(record.stableRouteSlug) ||
      options.existingRouteSlugs?.has(record.stableRouteSlug)
    ) {
      throw new Error("Duplicate route slug: " + record.stableRouteSlug);
    }
    routeSlugs.add(record.stableRouteSlug);
    productSlugs.add(record.stableProductSlug);
    if (
      options.allowedSourceHosts !== undefined &&
      !options.allowedSourceHosts.has(new URL(record.sourceUrl).hostname.toLowerCase())
    ) {
      throw new Error("Source host is not registered: " + record.sourceId);
    }
    if (new Date(record.verifiedAt).getTime() > now.getTime() + 60_000) {
      throw new Error("Verification date is in the future: " + record.stableRouteSlug);
    }
    if (new Date(record.reverifyAt) <= now) {
      throw new Error("Verification is already expired: " + record.stableRouteSlug);
    }
  }
  for (const productSlug of productSlugs) {
    if (options.existingProductSlugs?.has(productSlug)) {
      throw new Error("Duplicate product slug: " + productSlug);
    }
  }
  return document;
}

export function parseManualJsonImport(
  json: string,
  options: ImportValidationOptions = {}
): ManualImportDocument {
  if (Buffer.byteLength(json, "utf8") > 5 * 1024 * 1024) {
    throw new Error("Import exceeds the five-megabyte limit");
  }
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    throw new Error("Import is not valid JSON");
  }
  return validateImportDocument(input, options);
}

export function neutralizeCsvFormula(value: string): string {
  return dangerousSpreadsheetPrefix.test(value) ? "'" + value : value;
}

export function parseCsvRows(csv: string): ReadonlyArray<ReadonlyArray<string>> {
  if (Buffer.byteLength(csv, "utf8") > 5 * 1024 * 1024) {
    throw new Error("CSV exceeds the five-megabyte limit");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] ?? "";
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error("CSV contains an unclosed quoted field");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function findDuplicateSlugs(
  records: ReadonlyArray<Pick<ManualImportRecord, "stableProductSlug" | "stableRouteSlug">>
): Readonly<{ productSlugs: ReadonlyArray<string>; routeSlugs: ReadonlyArray<string> }> {
  const productCounts = new Map<string, number>();
  const routeCounts = new Map<string, number>();
  for (const record of records) {
    productCounts.set(
      record.stableProductSlug,
      (productCounts.get(record.stableProductSlug) ?? 0) + 1
    );
    routeCounts.set(record.stableRouteSlug, (routeCounts.get(record.stableRouteSlug) ?? 0) + 1);
  }
  return {
    productSlugs: [...productCounts]
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug)
      .sort(),
    routeSlugs: [...routeCounts]
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug)
      .sort()
  };
}

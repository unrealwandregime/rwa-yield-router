import { z } from "zod";
import { confidenceClassificationSchema } from "@rwa-yield-router/domain";

import { CATEGORY_VALUES } from "@/lib/constants";

const savedObjectNameSchema = z.string().trim().min(1).max(120);
const routeSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(128);

export const comparisonRouteSlugsSchema = z
  .array(routeSlugSchema)
  .min(2)
  .max(5)
  .superRefine((slugs, context) => {
    if (new Set(slugs).size !== slugs.length) {
      context.addIssue({
        code: "custom",
        message: "Comparison routes must be unique."
      });
    }
  });

export const savedComparisonCreateSchema = z
  .object({
    name: savedObjectNameSchema,
    routeSlugs: comparisonRouteSlugsSchema
  })
  .strict();

export const savedComparisonUpdateSchema = z
  .object({
    id: z.uuid(),
    name: savedObjectNameSchema.optional(),
    routeSlugs: comparisonRouteSlugsSchema.optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.routeSlugs !== undefined, {
    message: "A saved comparison update must change its name or routes."
  });

export const savedObjectIdSchema = z.object({ id: z.uuid() }).strict();

export const isSavableRouteState = (route: {
  archivedAt: Date | null;
  effectiveTo: Date | null;
  lifecycleStatus: string;
  publicationStatus: string;
}) =>
  route.archivedAt === null &&
  route.effectiveTo === null &&
  route.lifecycleStatus === "ACTIVE" &&
  route.publicationStatus === "PUBLISHED";

export const SCREENER_COLUMN_VALUES = [
  "product",
  "category",
  "issuer",
  "underlying",
  "yieldSource",
  "chain",
  "grossApy",
  "netApy",
  "riskAdjustedApy",
  "risk",
  "aumTvl",
  "liquidity",
  "redemption",
  "eligibility",
  "confidence",
  "admission",
  "updated"
] as const;

export type ScreenerColumn = (typeof SCREENER_COLUMN_VALUES)[number];

export const SCREENER_COLUMN_LABELS: Readonly<Record<ScreenerColumn, string>> = {
  admission: "Admission",
  aumTvl: "AUM / TVL",
  category: "Category",
  chain: "Chain",
  confidence: "Confidence",
  eligibility: "KYC / eligibility",
  grossApy: "Gross APY",
  issuer: "Issuer / protocol",
  liquidity: "Liquidity",
  netApy: "Net APY",
  product: "Product / route",
  redemption: "Redemption",
  risk: "Risk",
  riskAdjustedApy: "Risk-adjusted APY",
  underlying: "Underlying",
  updated: "Updated",
  yieldSource: "Yield source"
};

export const screenerSortKeySchema = z.enum([
  "product",
  "grossApy",
  "riskAdjustedApy",
  "risk",
  "recent"
]);

export type ScreenerSortKey = z.infer<typeof screenerSortKeySchema>;

export const savedViewStateSchema = z
  .object({
    filters: z
      .object({
        category: z.enum(CATEGORY_VALUES).nullable(),
        chain: z.string().trim().min(1).max(80).nullable(),
        confidence: confidenceClassificationSchema.nullable(),
        query: z.string().trim().max(120)
      })
      .strict(),
    sort: z.object({ key: screenerSortKeySchema }).strict(),
    visibleColumns: z
      .array(z.enum(SCREENER_COLUMN_VALUES))
      .min(1)
      .max(SCREENER_COLUMN_VALUES.length)
      .superRefine((columns, context) => {
        if (new Set(columns).size !== columns.length) {
          context.addIssue({ code: "custom", message: "Visible columns must be unique." });
        }
      })
  })
  .strict();

export const savedViewCreateSchema = savedViewStateSchema
  .extend({ name: savedObjectNameSchema })
  .strict();

export const savedViewUpdateSchema = savedViewCreateSchema.extend({ id: z.uuid() }).strict();

export type SavedViewState = z.infer<typeof savedViewStateSchema>;

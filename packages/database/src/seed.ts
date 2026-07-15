import { and, eq } from "drizzle-orm";
import { CATEGORY_WEIGHTS_V1, RISK_FACTORS, riskFactorSchema } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { z } from "zod";

import type { Database } from "./client.js";
import {
  assets,
  productCategories,
  riskMethodologyCategoryWeights,
  riskMethodologyVersions,
  roles,
  users,
  yieldSources
} from "./schema/index.js";

const canonicalCategories = [
  {
    code: "TOKENIZED_TBILL" as const,
    displayName: "Tokenized Treasury Bills",
    description:
      "Tokenized products whose sourced income is primarily tied to short-duration government securities."
  },
  {
    code: "STABLECOIN_VAULT" as const,
    displayName: "Stablecoin Vaults",
    description: "Vault routes that deploy stablecoins through an identified and sourced strategy."
  },
  {
    code: "DEFI_LENDING" as const,
    displayName: "DeFi Lending",
    description:
      "Lending routes whose yield is primarily borrower-paid interest with incentives separated."
  },
  {
    code: "MONEY_MARKET_TOKEN" as const,
    displayName: "Money Market Tokens",
    description: "Tokenized money-market products with sourced issuer or fund economics."
  },
  {
    code: "GOLD_BACKED_TOKEN" as const,
    displayName: "Gold-Backed Tokens",
    description:
      "Tokens representing gold exposure; asset-price appreciation is not classified as yield."
  },
  {
    code: "CASH_EQUIVALENT" as const,
    displayName: "Cash Equivalents",
    description:
      "On-chain cash-equivalent products whose native and route-level yield remain distinct."
  }
] as const;

const canonicalYieldSources = [
  ["TREASURY_COUPON", "Treasury coupon", false],
  ["MONEY_MARKET_INCOME", "Money-market income", false],
  ["BORROWER_INTEREST", "Borrower interest", false],
  ["REPO_INCOME", "Repo income", false],
  ["VAULT_STRATEGY", "Vault strategy", false],
  ["STAKING_OR_PROTOCOL_REWARD", "Staking or protocol reward", true],
  ["TOKEN_INCENTIVE", "Token incentive", true],
  ["BASIS_OR_HEDGING_STRATEGY", "Basis or hedging strategy", false],
  ["OTHER_VERIFIED", "Other verified income", false],
  ["NO_NATIVE_YIELD", "No native yield", false]
] as const;

const canonicalRoles = [
  ["USER", "Ordinary authenticated user with access only to owned account resources."],
  ["DATA_REVIEWER", "Reviewer of sourced catalog and observation records."],
  ["OPERATOR", "Operator for bounded jobs and operational visibility."],
  ["ADMIN", "Administrator for reviewed catalog and publication workflows."],
  ["SECURITY_ADMIN", "Administrator for security-sensitive role and incident workflows."]
] as const;

const CANONICAL_METHODOLOGY_VERSION = "1.0.0";
const CANONICAL_METHODOLOGY_EFFECTIVE_FROM = new Date("2026-07-13T00:00:00.000Z");
const CANONICAL_METHODOLOGY_CONFIGURATION = {
  maxAnnualPenaltyPp: "12",
  methodologyDocument: "RISK_METHODOLOGY.md",
  minimumEvidenceCoveragePct: "70",
  semanticVersion: CANONICAL_METHODOLOGY_VERSION,
  unknownRiskProxy: "75"
} as const;

const methodologyConfigurationSchema = z
  .object({
    maxAnnualPenaltyPp: z.literal(CANONICAL_METHODOLOGY_CONFIGURATION.maxAnnualPenaltyPp),
    methodologyDocument: z.literal(CANONICAL_METHODOLOGY_CONFIGURATION.methodologyDocument),
    minimumEvidenceCoveragePct: z.literal(
      CANONICAL_METHODOLOGY_CONFIGURATION.minimumEvidenceCoveragePct
    ),
    semanticVersion: z.literal(CANONICAL_METHODOLOGY_CONFIGURATION.semanticVersion),
    unknownRiskProxy: z.literal(CANONICAL_METHODOLOGY_CONFIGURATION.unknownRiskProxy)
  })
  .strict();

export const buildCanonicalMethodologyWeightRows = (
  methodologyVersionId: string,
  categoryIds: ReadonlyMap<keyof typeof CATEGORY_WEIGHTS_V1, string>
) =>
  canonicalCategories.flatMap(({ code: category }) => {
    const weights = CATEGORY_WEIGHTS_V1[category];
    const categoryId = categoryIds.get(category);
    if (categoryId === undefined) throw new Error(`Canonical category ${category} is not seeded`);
    return RISK_FACTORS.map((factorCode) => ({
      categoryId,
      factorCode,
      methodologyVersionId,
      missingEvidencePolicy: { mode: "UNKNOWN_RISK_PROXY" },
      penaltyConfiguration: {
        maxAnnualPenaltyPp: CANONICAL_METHODOLOGY_CONFIGURATION.maxAnnualPenaltyPp
      },
      weight: new Decimal(weights[factorCode]).div(100).toFixed(10)
    }));
  });

export const assertCanonicalMethodologyWeights = (
  rows: ReadonlyArray<
    Readonly<{ category: keyof typeof CATEGORY_WEIGHTS_V1; factorCode: string; weight: string }>
  >
): void => {
  const expectedCount = canonicalCategories.length * RISK_FACTORS.length;
  if (rows.length !== expectedCount)
    throw new Error(
      `Canonical methodology weight drift: found ${rows.length}, expected ${expectedCount}`
    );
  const keys = new Set<string>();
  const expectedByKey: ReadonlyMap<string, string> = new Map(
    canonicalCategories.flatMap(({ code: category }) =>
      RISK_FACTORS.map(
        (factor) => [`${category}:${factor}`, CATEGORY_WEIGHTS_V1[category][factor]] as const
      )
    )
  );
  for (const { code: category } of canonicalCategories) {
    const categoryRows = rows.filter((row) => row.category === category);
    const total = categoryRows.reduce((sum, row) => {
      const parsedFactor = riskFactorSchema.safeParse(row.factorCode);
      if (!parsedFactor.success)
        throw new Error(`Canonical methodology contains unknown factor ${row.factorCode}`);
      const key = `${category}:${parsedFactor.data}`;
      const expected = expectedByKey.get(key);
      if (expected === undefined)
        throw new Error(`Canonical methodology contains unknown factor ${row.factorCode}`);
      if (keys.has(key)) throw new Error(`Canonical methodology contains duplicate weight ${key}`);
      keys.add(key);
      if (!new Decimal(row.weight).mul(100).eq(expected))
        throw new Error(`Canonical methodology weight drift at ${key}`);
      return sum.plus(row.weight);
    }, new Decimal(0));
    if (categoryRows.length !== RISK_FACTORS.length || !total.eq(1))
      throw new Error(`Canonical methodology weights for ${category} do not total exactly one`);
  }
};

export const seedCanonicalReferenceData = async (database: Database): Promise<void> => {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(assets)
      .values([
        { assetType: "FIAT", currencyCode: "USD", decimals: 2, name: "US Dollar", symbol: "USD" },
        {
          assetType: "STABLECOIN",
          currencyCode: "USD",
          decimals: 6,
          name: "USD Coin",
          symbol: "USDC"
        },
        {
          assetType: "STABLECOIN",
          currencyCode: "USD",
          decimals: 6,
          name: "Tether USD",
          symbol: "USDT"
        }
      ])
      .onConflictDoNothing({ target: [assets.symbol, assets.assetType] });

    await transaction
      .insert(productCategories)
      .values([...canonicalCategories])
      .onConflictDoNothing({ target: productCategories.code });

    await transaction
      .insert(yieldSources)
      .values(
        canonicalYieldSources.map(([sourceClass, name, isIncentive]) => ({
          description: `Canonical ${name.toLocaleLowerCase("en-US")} classification.`,
          isIncentive,
          name,
          sourceClass
        }))
      )
      .onConflictDoNothing({
        target: [yieldSources.sourceClass, yieldSources.name]
      });

    await transaction
      .insert(roles)
      .values(canonicalRoles.map(([code, description]) => ({ code, description })))
      .onConflictDoNothing({ target: roles.code });

    await transaction
      .insert(users)
      .values([
        { authProvider: "system", authSubjectId: "admin-bootstrap-v1" },
        { authProvider: "system", authSubjectId: "methodology-reviewer-v1" },
        { authProvider: "system", authSubjectId: "methodology-publisher-v1" }
      ])
      .onConflictDoNothing({ target: [users.authProvider, users.authSubjectId] });
    const systemPrincipals = await transaction
      .select({ id: users.id, subject: users.authSubjectId })
      .from(users)
      .where(and(eq(users.authProvider, "system"), eq(users.status, "ACTIVE")));
    const reviewer = systemPrincipals.find(
      (principal) => principal.subject === "methodology-reviewer-v1"
    );
    const publisher = systemPrincipals.find(
      (principal) => principal.subject === "methodology-publisher-v1"
    );
    if (!reviewer || !publisher)
      throw new Error("Canonical methodology principals were not seeded");
    await transaction
      .insert(riskMethodologyVersions)
      .values({
        calculationVersion: "risk-engine-v1.0.0",
        configuration: CANONICAL_METHODOLOGY_CONFIGURATION,
        description: "Published category-weighted comparative risk methodology v1.",
        effectiveFrom: CANONICAL_METHODOLOGY_EFFECTIVE_FROM,
        publicationStatus: "PUBLISHED",
        publishedAt: CANONICAL_METHODOLOGY_EFFECTIVE_FROM,
        publishedByUserId: publisher.id,
        reviewedAt: CANONICAL_METHODOLOGY_EFFECTIVE_FROM,
        reviewedByUserId: reviewer.id,
        version: CANONICAL_METHODOLOGY_VERSION
      })
      .onConflictDoNothing({ target: riskMethodologyVersions.version });

    const [methodology] = await transaction
      .select()
      .from(riskMethodologyVersions)
      .where(eq(riskMethodologyVersions.version, CANONICAL_METHODOLOGY_VERSION))
      .limit(1);
    if (
      methodology === undefined ||
      methodology.publicationStatus !== "PUBLISHED" ||
      methodology.calculationVersion !== "risk-engine-v1.0.0" ||
      methodology.effectiveFrom.getTime() !== CANONICAL_METHODOLOGY_EFFECTIVE_FROM.getTime() ||
      !methodologyConfigurationSchema.safeParse(methodology.configuration).success
    ) {
      throw new Error(
        "Published canonical methodology 1.0.0 has drifted; seed will not overwrite it"
      );
    }

    const categoryRows = await transaction
      .select({ code: productCategories.code, id: productCategories.id })
      .from(productCategories);
    const categoryIds = new Map(categoryRows.map((category) => [category.code, category.id]));
    await transaction
      .insert(riskMethodologyCategoryWeights)
      .values(buildCanonicalMethodologyWeightRows(methodology.id, categoryIds))
      .onConflictDoNothing({
        target: [
          riskMethodologyCategoryWeights.methodologyVersionId,
          riskMethodologyCategoryWeights.categoryId,
          riskMethodologyCategoryWeights.factorCode
        ]
      });
    const persistedWeights = await transaction
      .select({
        category: productCategories.code,
        factorCode: riskMethodologyCategoryWeights.factorCode,
        weight: riskMethodologyCategoryWeights.weight
      })
      .from(riskMethodologyCategoryWeights)
      .innerJoin(
        productCategories,
        eq(riskMethodologyCategoryWeights.categoryId, productCategories.id)
      )
      .where(eq(riskMethodologyCategoryWeights.methodologyVersionId, methodology.id));
    assertCanonicalMethodologyWeights(persistedWeights);
  });
};

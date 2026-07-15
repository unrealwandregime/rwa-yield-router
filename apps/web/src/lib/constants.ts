export const SITE_NAME = "RWA Yield Router";
export const SITE_DESCRIPTION =
  "Compare where yield comes from, what comparative risks you take, and how easily you can exit.";

export const CATEGORY_VALUES = [
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
] as const;

export type Category = (typeof CATEGORY_VALUES)[number];

export const CATEGORY_META: Record<
  Category,
  { label: string; shortLabel: string; description: string }
> = {
  TOKENIZED_TBILL: {
    label: "Tokenized T-bills",
    shortLabel: "T-bills",
    description: "Government-security exposure delivered through sourced tokenized instruments."
  },
  STABLECOIN_VAULT: {
    label: "Stablecoin vaults",
    shortLabel: "Vaults",
    description:
      "Managed on-chain strategies with separately identified native and incentive yield."
  },
  DEFI_LENDING: {
    label: "DeFi lending",
    shortLabel: "Lending",
    description: "Supply routes earning borrower-paid interest through verified lending markets."
  },
  MONEY_MARKET_TOKEN: {
    label: "Money-market tokens",
    shortLabel: "Money markets",
    description: "Tokens designed to pass through money-market or Treasury income."
  },
  GOLD_BACKED_TOKEN: {
    label: "Gold-backed tokens",
    shortLabel: "Gold",
    description: "Gold-price exposure and any separate, sourced route-level yield."
  },
  CASH_EQUIVALENT: {
    label: "Cash-equivalent products",
    shortLabel: "Cash equivalents",
    description: "On-chain cash products with explicit reserve, access, and liquidity evidence."
  }
};

export const categorySlug = (category: Category): string =>
  category.toLowerCase().replaceAll("_", "-");

export const categoryFromSlug = (slug: string): Category | undefined =>
  CATEGORY_VALUES.find((category) => categorySlug(category) === slug);

export const LEGAL_DISCLOSURE =
  "Informational analytics only. APYs are variable, historical data does not guarantee future results, and product availability depends on jurisdiction and investor status. RWA Yield Router does not take custody or execute transactions.";

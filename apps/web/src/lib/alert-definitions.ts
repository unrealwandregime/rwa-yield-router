export const ALERT_TRIGGER_DEFINITIONS = [
  { label: "APY above threshold", trigger: "APY_ABOVE", unit: "PERCENTAGE_POINTS" },
  { label: "APY below threshold", trigger: "APY_BELOW", unit: "PERCENTAGE_POINTS" },
  {
    label: "APY change over lookback",
    lookback: true,
    trigger: "APY_CHANGE",
    unit: "PERCENTAGE_POINTS"
  },
  { label: "Incentive ending within days", trigger: "INCENTIVE_ENDING", unit: "DAYS" },
  {
    label: "TVL or AUM decline",
    lookback: true,
    trigger: "TVL_DECLINE",
    unit: "PERCENT_DECLINE"
  },
  {
    label: "Liquidity deterioration",
    lookback: true,
    trigger: "LIQUIDITY_DETERIORATION",
    unit: "PERCENT_DECLINE"
  },
  { label: "Utilization spike", trigger: "UTILIZATION_SPIKE", unit: "PERCENTAGE_POINTS" },
  { label: "NAV deviation", trigger: "NAV_DEVIATION", unit: "PERCENTAGE_POINTS" },
  {
    label: "Risk-score increase",
    lookback: true,
    trigger: "RISK_INCREASE",
    unit: "RISK_POINTS"
  },
  {
    label: "Confidence downgrade",
    lookback: true,
    trigger: "CONFIDENCE_DOWNGRADE",
    unit: "CONFIDENCE_LEVELS"
  },
  { label: "Data becomes stale", trigger: "DATA_STALE", unit: "HOURS" },
  { event: true, label: "Redemption terms change", trigger: "REDEMPTION_CHANGE" },
  { event: true, label: "Eligibility changes", trigger: "ELIGIBILITY_CHANGE" },
  { event: true, label: "Issuer or protocol warning", trigger: "ISSUER_PROTOCOL_WARNING" },
  { label: "Stablecoin depeg", trigger: "STABLECOIN_DEPEG", unit: "PERCENTAGE_POINTS" },
  { event: true, label: "Vault allocation change", trigger: "VAULT_ALLOCATION_CHANGE" },
  { event: true, label: "Product pause or closure", trigger: "PRODUCT_STATUS" }
] as const;

export type AlertTrigger = (typeof ALERT_TRIGGER_DEFINITIONS)[number]["trigger"];

export const ALERT_TRIGGER_MAP: Record<
  AlertTrigger,
  | "APY_ABOVE"
  | "APY_BELOW"
  | "APY_CHANGE"
  | "INCENTIVE_END"
  | "TVL_AUM_DECLINE"
  | "LIQUIDITY_DETERIORATION"
  | "UTILIZATION_SPIKE"
  | "NAV_DEVIATION"
  | "RISK_SCORE_INCREASE"
  | "CONFIDENCE_DOWNGRADE"
  | "STALE_DATA"
  | "REDEMPTION_CHANGE"
  | "ELIGIBILITY_CHANGE"
  | "ISSUER_PROTOCOL_WARNING"
  | "STABLECOIN_DEPEG"
  | "VAULT_ALLOCATION_CHANGE"
  | "PRODUCT_STATUS_CHANGE"
> = {
  APY_ABOVE: "APY_ABOVE",
  APY_BELOW: "APY_BELOW",
  APY_CHANGE: "APY_CHANGE",
  CONFIDENCE_DOWNGRADE: "CONFIDENCE_DOWNGRADE",
  DATA_STALE: "STALE_DATA",
  ELIGIBILITY_CHANGE: "ELIGIBILITY_CHANGE",
  INCENTIVE_ENDING: "INCENTIVE_END",
  ISSUER_PROTOCOL_WARNING: "ISSUER_PROTOCOL_WARNING",
  LIQUIDITY_DETERIORATION: "LIQUIDITY_DETERIORATION",
  NAV_DEVIATION: "NAV_DEVIATION",
  PRODUCT_STATUS: "PRODUCT_STATUS_CHANGE",
  REDEMPTION_CHANGE: "REDEMPTION_CHANGE",
  RISK_INCREASE: "RISK_SCORE_INCREASE",
  STABLECOIN_DEPEG: "STABLECOIN_DEPEG",
  TVL_DECLINE: "TVL_AUM_DECLINE",
  UTILIZATION_SPIKE: "UTILIZATION_SPIKE",
  VAULT_ALLOCATION_CHANGE: "VAULT_ALLOCATION_CHANGE"
};

export const alertTriggerDefinition = (trigger: AlertTrigger) => {
  const definition = ALERT_TRIGGER_DEFINITIONS.find((candidate) => candidate.trigger === trigger);
  if (definition === undefined) throw new Error("ALERT_TRIGGER_DEFINITION_MISSING");
  return definition;
};

import { pgEnum } from "drizzle-orm/pg-core";

export const publicationStatusEnum = pgEnum("publication_status", [
  "DRAFT",
  "REVIEWED",
  "PUBLISHED",
  "REJECTED",
  "ARCHIVED",
  "SUPERSEDED"
]);

export const catalogImportPublicationStatusEnum = pgEnum("catalog_import_publication_status", [
  "DRAFT",
  "GATED",
  "PUBLISHED"
]);

export const catalogDiscoveryStatusEnum = pgEnum("catalog_discovery_status", [
  "IDENTITY_CONFIRMED",
  "SOURCE_CONFIRMED",
  "ADMISSION_GATED"
]);

export const lifecycleStatusEnum = pgEnum("lifecycle_status", [
  "ACTIVE",
  "PAUSED",
  "RESTRICTED",
  "CLOSED",
  "UNAVAILABLE",
  "ARCHIVED"
]);

export const productCategoryCodeEnum = pgEnum("product_category_code", [
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
]);

export const yieldSourceClassEnum = pgEnum("yield_source_class", [
  "TREASURY_COUPON",
  "MONEY_MARKET_INCOME",
  "BORROWER_INTEREST",
  "REPO_INCOME",
  "VAULT_STRATEGY",
  "STAKING_OR_PROTOCOL_REWARD",
  "TOKEN_INCENTIVE",
  "BASIS_OR_HEDGING_STRATEGY",
  "OTHER_VERIFIED",
  "NO_NATIVE_YIELD"
]);

export const confidenceClassEnum = pgEnum("confidence_class", [
  "VERIFIED_OFFICIAL",
  "DIRECT_API",
  "ONCHAIN_DERIVED",
  "ISSUER_REPORTED",
  "THIRD_PARTY",
  "MANUALLY_VERIFIED",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
]);

export const dataStatusEnum = pgEnum("data_status", [
  "AVAILABLE",
  "UNKNOWN",
  "UNAVAILABLE",
  "STALE",
  "ESTIMATED",
  "CONFLICTED",
  "RESTRICTED",
  "AWAITING_VERIFICATION",
  "REJECTED",
  "DEGRADED"
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "OFFICIAL_API",
  "OFFICIAL_DOCUMENT",
  "ONCHAIN",
  "ORACLE",
  "SUBGRAPH",
  "RPC",
  "THIRD_PARTY_API",
  "MANUAL_CURATED"
]);

export const sourceStatusEnum = pgEnum("source_status", [
  "ACTIVE",
  "DEGRADED",
  "DISABLED",
  "REMOVED"
]);

export const observationValueTypeEnum = pgEnum("observation_value_type", [
  "NUMERIC",
  "TEXT",
  "BOOLEAN",
  "JSON",
  "NONE"
]);

export const accessMethodEnum = pgEnum("access_method", [
  "NATIVE_HOLD",
  "ISSUER_MINT",
  "ISSUER_REDEMPTION",
  "DEX_PURCHASE",
  "LENDING_DEPOSIT",
  "VAULT_DEPOSIT",
  "FIXED_TERM",
  "OTHER_VERIFIED"
]);

export const investorClassificationEnum = pgEnum("investor_classification", [
  "RETAIL",
  "ACCREDITED",
  "QUALIFIED",
  "PROFESSIONAL",
  "INSTITUTIONAL",
  "UNKNOWN"
]);

export const eligibilityStatusEnum = pgEnum("eligibility_status", [
  "ELIGIBLE",
  "INELIGIBLE",
  "CONDITIONAL",
  "UNKNOWN"
]);

export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "DISABLED",
  "DELETION_PENDING",
  "ANONYMIZED"
]);

export const roleCodeEnum = pgEnum("role_code", [
  "USER",
  "DATA_REVIEWER",
  "OPERATOR",
  "ADMIN",
  "SECURITY_ADMIN"
]);

export const componentTypeEnum = pgEnum("apy_component_type", [
  "BASE_APY",
  "BORROWER_PAID_APY",
  "TREASURY_OR_MONEY_MARKET_APY",
  "STRATEGY_APY",
  "REWARD_TOKEN_APY",
  "OTHER_INCENTIVE_APY",
  "GROSS_APY",
  "NET_APY"
]);

export const feeTypeEnum = pgEnum("fee_type", [
  "MANAGEMENT",
  "PERFORMANCE",
  "PROTOCOL",
  "ENTRY",
  "EXIT",
  "GAS",
  "SLIPPAGE",
  "OTHER_VERIFIED"
]);

export const riskResultStatusEnum = pgEnum("risk_result_status", [
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE"
]);

export const simulationStatusEnum = pgEnum("simulation_status", [
  "PENDING",
  "FEASIBLE",
  "INFEASIBLE",
  "INVALID",
  "FAILED"
]);

export const alertConditionEnum = pgEnum("alert_condition", [
  "APY_ABOVE",
  "APY_BELOW",
  "APY_CHANGE",
  "INCENTIVE_END",
  "TVL_AUM_DECLINE",
  "LIQUIDITY_DETERIORATION",
  "UTILIZATION_SPIKE",
  "NAV_DEVIATION",
  "RISK_SCORE_INCREASE",
  "CONFIDENCE_DOWNGRADE",
  "STALE_DATA",
  "REDEMPTION_CHANGE",
  "ELIGIBILITY_CHANGE",
  "ISSUER_PROTOCOL_WARNING",
  "STABLECOIN_DEPEG",
  "VAULT_ALLOCATION_CHANGE",
  "PRODUCT_STATUS_CHANGE"
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "EMAIL",
  "TELEGRAM",
  "CONSOLE"
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "QUEUED",
  "ATTEMPTING",
  "DELIVERED",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "SUPPRESSED",
  "CANCELLED"
]);

export const jobStatusEnum = pgEnum("job_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTERED",
  "CANCELLED"
]);

export const qualityEventTypeEnum = pgEnum("quality_event_type", [
  "CONFLICT",
  "IMPLAUSIBLE_CHANGE",
  "MISSING",
  "STALE_TRANSITION",
  "UNAVAILABLE_TRANSITION",
  "MANUAL_OVERRIDE",
  "RECOVERED"
]);

export const reviewOutcomeEnum = pgEnum("review_outcome", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FAILED"
]);

export const adapterHealthOutcomeEnum = pgEnum("adapter_health_outcome", [
  "SUCCEEDED",
  "DEGRADED",
  "FAILED"
]);

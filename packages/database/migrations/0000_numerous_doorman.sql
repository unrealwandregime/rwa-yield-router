CREATE TYPE "public"."access_method" AS ENUM('NATIVE_HOLD', 'ISSUER_MINT', 'ISSUER_REDEMPTION', 'DEX_PURCHASE', 'LENDING_DEPOSIT', 'VAULT_DEPOSIT', 'FIXED_TERM', 'OTHER_VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."alert_condition" AS ENUM('APY_ABOVE', 'APY_BELOW', 'APY_CHANGE', 'INCENTIVE_END', 'TVL_AUM_DECLINE', 'LIQUIDITY_DETERIORATION', 'UTILIZATION_SPIKE', 'NAV_DEVIATION', 'RISK_SCORE_INCREASE', 'CONFIDENCE_DOWNGRADE', 'STALE_DATA', 'REDEMPTION_CHANGE', 'ELIGIBILITY_CHANGE', 'ISSUER_PROTOCOL_WARNING', 'STABLECOIN_DEPEG', 'VAULT_ALLOCATION_CHANGE', 'PRODUCT_STATUS_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."apy_component_type" AS ENUM('BASE_APY', 'BORROWER_PAID_APY', 'TREASURY_OR_MONEY_MARKET_APY', 'STRATEGY_APY', 'REWARD_TOKEN_APY', 'OTHER_INCENTIVE_APY', 'GROSS_APY', 'NET_APY');--> statement-breakpoint
CREATE TYPE "public"."confidence_class" AS ENUM('VERIFIED_OFFICIAL', 'DIRECT_API', 'ONCHAIN_DERIVED', 'ISSUER_REPORTED', 'THIRD_PARTY', 'MANUALLY_VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."data_status" AS ENUM('AVAILABLE', 'UNKNOWN', 'UNAVAILABLE', 'STALE', 'ESTIMATED', 'CONFLICTED', 'RESTRICTED', 'AWAITING_VERIFICATION', 'REJECTED', 'DEGRADED');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('QUEUED', 'ATTEMPTING', 'DELIVERED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'SUPPRESSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."eligibility_status" AS ENUM('ELIGIBLE', 'INELIGIBLE', 'CONDITIONAL', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('MANAGEMENT', 'PERFORMANCE', 'PROTOCOL', 'ENTRY', 'EXIT', 'GAS', 'SLIPPAGE', 'OTHER_VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."investor_classification" AS ENUM('RETAIL', 'ACCREDITED', 'QUALIFIED', 'PROFESSIONAL', 'INSTITUTIONAL', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('ACTIVE', 'PAUSED', 'RESTRICTED', 'CLOSED', 'UNAVAILABLE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL', 'TELEGRAM', 'CONSOLE');--> statement-breakpoint
CREATE TYPE "public"."observation_value_type" AS ENUM('NUMERIC', 'TEXT', 'BOOLEAN', 'JSON', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."product_category_code" AS ENUM('TOKENIZED_TBILL', 'STABLECOIN_VAULT', 'DEFI_LENDING', 'MONEY_MARKET_TOKEN', 'GOLD_BACKED_TOKEN', 'CASH_EQUIVALENT');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('DRAFT', 'REVIEWED', 'PUBLISHED', 'REJECTED', 'ARCHIVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."quality_event_type" AS ENUM('CONFLICT', 'IMPLAUSIBLE_CHANGE', 'MISSING', 'STALE_TRANSITION', 'UNAVAILABLE_TRANSITION', 'MANUAL_OVERRIDE', 'RECOVERED');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."risk_result_status" AS ENUM('AVAILABLE', 'PARTIAL', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('USER', 'DATA_REVIEWER', 'OPERATOR', 'ADMIN', 'SECURITY_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."simulation_status" AS ENUM('PENDING', 'FEASIBLE', 'INFEASIBLE', 'INVALID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ACTIVE', 'DEGRADED', 'DISABLED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('OFFICIAL_API', 'OFFICIAL_DOCUMENT', 'ONCHAIN', 'ORACLE', 'SUBGRAPH', 'RPC', 'THIRD_PARTY_API', 'MANUAL_CURATED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'DELETION_PENDING', 'ANONYMIZED');--> statement-breakpoint
CREATE TYPE "public"."yield_source_class" AS ENUM('TREASURY_COUPON', 'MONEY_MARKET_INCOME', 'BORROWER_INTEREST', 'REPO_INCOME', 'VAULT_STRATEGY', 'STAKING_OR_PROTOCOL_REWARD', 'TOKEN_INCENTIVE', 'BASIS_OR_HEDGING_STRATEGY', 'OTHER_VERIFIED', 'NO_NATIVE_YIELD');--> statement-breakpoint
CREATE TABLE "apy_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"yield_snapshot_id" uuid NOT NULL,
	"yield_source_id" uuid,
	"source_observation_id" uuid,
	"component_type" "apy_component_type" NOT NULL,
	"value" numeric(24, 18),
	"unit" varchar(64) NOT NULL,
	"source_period_days" numeric(20, 6),
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"is_variable" boolean NOT NULL,
	"is_promotional" boolean NOT NULL,
	"promotion_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apy_components_snapshot_type_source_unique" UNIQUE("yield_snapshot_id","component_type","yield_source_id"),
	CONSTRAINT "apy_components_unit_not_blank" CHECK (btrim("apy_components"."unit") <> ''),
	CONSTRAINT "apy_components_period_positive" CHECK ("apy_components"."source_period_days" is null or "apy_components"."source_period_days" > 0),
	CONSTRAINT "apy_components_available_value" CHECK ("apy_components"."status" <> 'AVAILABLE' or "apy_components"."value" is not null),
	CONSTRAINT "apy_components_unavailable_null" CHECK ("apy_components"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or "apy_components"."value" is null),
	CONSTRAINT "apy_components_promotion_expiry" CHECK (not "apy_components"."is_promotional" or "apy_components"."promotion_ends_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "composite_risk_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"methodology_version_id" uuid NOT NULL,
	"result_status" "risk_result_status" NOT NULL,
	"composite_score" numeric(5, 2),
	"coverage_ratio" numeric(24, 18) NOT NULL,
	"uncertainty_penalty" numeric(24, 18),
	"total_comparative_apy_penalty" numeric(24, 18),
	"explanation" text NOT NULL,
	"calculation_inputs" jsonb NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"calculation_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composite_risk_snapshots_target_method_time_unique" UNIQUE("product_id","route_id","methodology_version_id","calculated_at"),
	CONSTRAINT "composite_risk_snapshots_exactly_one_parent" CHECK (num_nonnulls("composite_risk_snapshots"."product_id", "composite_risk_snapshots"."route_id") = 1),
	CONSTRAINT "composite_risk_snapshots_score_range" CHECK ("composite_risk_snapshots"."composite_score" is null or ("composite_risk_snapshots"."composite_score" >= 0 and "composite_risk_snapshots"."composite_score" <= 100)),
	CONSTRAINT "composite_risk_snapshots_coverage_range" CHECK ("composite_risk_snapshots"."coverage_ratio" >= 0 and "composite_risk_snapshots"."coverage_ratio" <= 1),
	CONSTRAINT "composite_risk_snapshots_status_score" CHECK (("composite_risk_snapshots"."result_status" = 'UNAVAILABLE' and "composite_risk_snapshots"."composite_score" is null) or ("composite_risk_snapshots"."result_status" <> 'UNAVAILABLE' and "composite_risk_snapshots"."composite_score" is not null)),
	CONSTRAINT "composite_risk_snapshots_inputs_object" CHECK (jsonb_typeof("composite_risk_snapshots"."calculation_inputs") = 'object')
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"fee_type" "fee_type" NOT NULL,
	"rate" numeric(24, 18),
	"fixed_amount" numeric(38, 18),
	"fixed_amount_asset_id" uuid,
	"unit" varchar(64) NOT NULL,
	"status" "data_status" NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"source_observation_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fee_schedules_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "fee_schedules_version_positive" CHECK ("fee_schedules"."version" > 0),
	CONSTRAINT "fee_schedules_exactly_one_parent" CHECK (num_nonnulls("fee_schedules"."product_id", "fee_schedules"."route_id") = 1),
	CONSTRAINT "fee_schedules_value_shape" CHECK (num_nonnulls("fee_schedules"."rate", "fee_schedules"."fixed_amount") <= 1 and (("fee_schedules"."fixed_amount" is null) = ("fee_schedules"."fixed_amount_asset_id" is null))),
	CONSTRAINT "fee_schedules_available_value" CHECK ("fee_schedules"."status" <> 'AVAILABLE' or num_nonnulls("fee_schedules"."rate", "fee_schedules"."fixed_amount") = 1),
	CONSTRAINT "fee_schedules_unavailable_value" CHECK ("fee_schedules"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls("fee_schedules"."rate", "fee_schedules"."fixed_amount") = 0),
	CONSTRAINT "fee_schedules_nonnegative" CHECK (("fee_schedules"."rate" is null or "fee_schedules"."rate" >= 0) and ("fee_schedules"."fixed_amount" is null or "fee_schedules"."fixed_amount" >= 0)),
	CONSTRAINT "fee_schedules_effective_interval" CHECK ("fee_schedules"."effective_to" is null or "fee_schedules"."effective_to" > "fee_schedules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "liquidity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quote_asset_id" uuid NOT NULL,
	"immediately_available" numeric(38, 18),
	"available_within_24h" numeric(38, 18),
	"available_within_7d" numeric(38, 18),
	"daily_volume" numeric(38, 18),
	"slippage_reference_amount" numeric(38, 18),
	"estimated_slippage_ratio" numeric(24, 18),
	CONSTRAINT "liquidity_snapshots_observation_quote_unique" UNIQUE("source_observation_id","quote_asset_id"),
	CONSTRAINT "liquidity_snapshots_exactly_one_parent" CHECK (num_nonnulls("liquidity_snapshots"."product_id", "liquidity_snapshots"."route_id") = 1),
	CONSTRAINT "liquidity_snapshots_nonnegative" CHECK (("liquidity_snapshots"."immediately_available" is null or "liquidity_snapshots"."immediately_available" >= 0) and ("liquidity_snapshots"."available_within_24h" is null or "liquidity_snapshots"."available_within_24h" >= 0) and ("liquidity_snapshots"."available_within_7d" is null or "liquidity_snapshots"."available_within_7d" >= 0) and ("liquidity_snapshots"."daily_volume" is null or "liquidity_snapshots"."daily_volume" >= 0) and ("liquidity_snapshots"."slippage_reference_amount" is null or "liquidity_snapshots"."slippage_reference_amount" >= 0) and ("liquidity_snapshots"."estimated_slippage_ratio" is null or "liquidity_snapshots"."estimated_slippage_ratio" >= 0)),
	CONSTRAINT "liquidity_snapshots_available_value" CHECK ("liquidity_snapshots"."status" <> 'AVAILABLE' or num_nonnulls("liquidity_snapshots"."immediately_available", "liquidity_snapshots"."available_within_24h", "liquidity_snapshots"."available_within_7d", "liquidity_snapshots"."daily_volume") > 0)
);
--> statement-breakpoint
CREATE TABLE "nav_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quote_asset_id" uuid NOT NULL,
	"nav_per_token" numeric(38, 18),
	"premium_discount_ratio" numeric(24, 18),
	CONSTRAINT "nav_snapshots_observation_quote_unique" UNIQUE("source_observation_id","quote_asset_id"),
	CONSTRAINT "nav_snapshots_exactly_one_parent" CHECK (num_nonnulls("nav_snapshots"."product_id", "nav_snapshots"."route_id") = 1),
	CONSTRAINT "nav_snapshots_available_value" CHECK ("nav_snapshots"."status" <> 'AVAILABLE' or "nav_snapshots"."nav_per_token" is not null),
	CONSTRAINT "nav_snapshots_unavailable_null" CHECK ("nav_snapshots"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls("nav_snapshots"."nav_per_token", "nav_snapshots"."premium_discount_ratio") = 0),
	CONSTRAINT "nav_snapshots_nonnegative" CHECK ("nav_snapshots"."nav_per_token" is null or "nav_snapshots"."nav_per_token" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quote_asset_id" uuid NOT NULL,
	"price" numeric(38, 18),
	CONSTRAINT "price_snapshots_observation_quote_unique" UNIQUE("source_observation_id","quote_asset_id"),
	CONSTRAINT "price_snapshots_exactly_one_parent" CHECK (num_nonnulls("price_snapshots"."product_id", "price_snapshots"."route_id") = 1),
	CONSTRAINT "price_snapshots_available_value" CHECK ("price_snapshots"."status" <> 'AVAILABLE' or "price_snapshots"."price" is not null),
	CONSTRAINT "price_snapshots_unavailable_null" CHECK ("price_snapshots"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or "price_snapshots"."price" is null),
	CONSTRAINT "price_snapshots_nonnegative" CHECK ("price_snapshots"."price" is null or "price_snapshots"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "risk_factor_evidence" (
	"risk_factor_snapshot_id" uuid NOT NULL,
	"source_observation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_factor_evidence_pk" PRIMARY KEY("risk_factor_snapshot_id","source_observation_id")
);
--> statement-breakpoint
CREATE TABLE "risk_factor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"methodology_version_id" uuid NOT NULL,
	"factor_code" varchar(96) NOT NULL,
	"result_status" "risk_result_status" NOT NULL,
	"score" numeric(5, 2),
	"explanation" text NOT NULL,
	"input_metrics" jsonb NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"calculation_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_factor_snapshots_target_method_time_unique" UNIQUE("product_id","route_id","methodology_version_id","factor_code","calculated_at"),
	CONSTRAINT "risk_factor_snapshots_exactly_one_parent" CHECK (num_nonnulls("risk_factor_snapshots"."product_id", "risk_factor_snapshots"."route_id") = 1),
	CONSTRAINT "risk_factor_snapshots_factor_not_blank" CHECK (btrim("risk_factor_snapshots"."factor_code") <> ''),
	CONSTRAINT "risk_factor_snapshots_score_range" CHECK ("risk_factor_snapshots"."score" is null or ("risk_factor_snapshots"."score" >= 0 and "risk_factor_snapshots"."score" <= 100)),
	CONSTRAINT "risk_factor_snapshots_status_score" CHECK (("risk_factor_snapshots"."result_status" = 'UNAVAILABLE' and "risk_factor_snapshots"."score" is null) or ("risk_factor_snapshots"."result_status" <> 'UNAVAILABLE' and "risk_factor_snapshots"."score" is not null)),
	CONSTRAINT "risk_factor_snapshots_inputs_object" CHECK (jsonb_typeof("risk_factor_snapshots"."input_metrics") = 'object')
);
--> statement-breakpoint
CREATE TABLE "risk_methodology_category_weights" (
	"methodology_version_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"factor_code" varchar(96) NOT NULL,
	"weight" numeric(12, 10) NOT NULL,
	"missing_evidence_policy" jsonb NOT NULL,
	"penalty_configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_methodology_category_weights_pk" PRIMARY KEY("methodology_version_id","category_id","factor_code"),
	CONSTRAINT "risk_methodology_weight_range" CHECK ("risk_methodology_category_weights"."weight" >= 0 and "risk_methodology_category_weights"."weight" <= 1),
	CONSTRAINT "risk_methodology_factor_not_blank" CHECK (btrim("risk_methodology_category_weights"."factor_code") <> ''),
	CONSTRAINT "risk_methodology_missing_policy_object" CHECK (jsonb_typeof("risk_methodology_category_weights"."missing_evidence_policy") = 'object'),
	CONSTRAINT "risk_methodology_penalty_config_object" CHECK (jsonb_typeof("risk_methodology_category_weights"."penalty_configuration") = 'object')
);
--> statement-breakpoint
CREATE TABLE "risk_methodology_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(64) NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"description" text NOT NULL,
	"calculation_version" varchar(64) NOT NULL,
	"configuration" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_methodology_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "risk_methodology_versions_configuration_object" CHECK (jsonb_typeof("risk_methodology_versions"."configuration") = 'object'),
	CONSTRAINT "risk_methodology_versions_effective_interval" CHECK ("risk_methodology_versions"."effective_to" is null or "risk_methodology_versions"."effective_to" > "risk_methodology_versions"."effective_from"),
	CONSTRAINT "risk_methodology_versions_review_pair" CHECK (("risk_methodology_versions"."reviewed_by_user_id" is null) = ("risk_methodology_versions"."reviewed_at" is null)),
	CONSTRAINT "risk_methodology_versions_publish_pair" CHECK (("risk_methodology_versions"."published_by_user_id" is null) = ("risk_methodology_versions"."published_at" is null)),
	CONSTRAINT "risk_methodology_versions_published_reviewed" CHECK ("risk_methodology_versions"."publication_status" <> 'PUBLISHED' or ("risk_methodology_versions"."reviewed_by_user_id" is not null and "risk_methodology_versions"."published_by_user_id" is not null and "risk_methodology_versions"."reviewed_by_user_id" <> "risk_methodology_versions"."published_by_user_id"))
);
--> statement-breakpoint
CREATE TABLE "tvl_aum_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metric_kind" varchar(8) NOT NULL,
	"quote_asset_id" uuid NOT NULL,
	"amount" numeric(38, 18),
	CONSTRAINT "tvl_aum_snapshots_observation_kind_unique" UNIQUE("source_observation_id","metric_kind","quote_asset_id"),
	CONSTRAINT "tvl_aum_snapshots_kind" CHECK ("tvl_aum_snapshots"."metric_kind" in ('TVL', 'AUM')),
	CONSTRAINT "tvl_aum_snapshots_exactly_one_parent" CHECK (num_nonnulls("tvl_aum_snapshots"."product_id", "tvl_aum_snapshots"."route_id") = 1),
	CONSTRAINT "tvl_aum_snapshots_available_value" CHECK ("tvl_aum_snapshots"."status" <> 'AVAILABLE' or "tvl_aum_snapshots"."amount" is not null),
	CONSTRAINT "tvl_aum_snapshots_unavailable_null" CHECK ("tvl_aum_snapshots"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or "tvl_aum_snapshots"."amount" is null),
	CONSTRAINT "tvl_aum_snapshots_nonnegative" CHECK ("tvl_aum_snapshots"."amount" is null or "tvl_aum_snapshots"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "utilization_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"utilization_ratio" numeric(24, 18),
	CONSTRAINT "utilization_snapshots_observation_unique" UNIQUE("source_observation_id"),
	CONSTRAINT "utilization_snapshots_exactly_one_parent" CHECK (num_nonnulls("utilization_snapshots"."product_id", "utilization_snapshots"."route_id") = 1),
	CONSTRAINT "utilization_snapshots_range" CHECK ("utilization_snapshots"."utilization_ratio" is null or ("utilization_snapshots"."utilization_ratio" >= 0 and "utilization_snapshots"."utilization_ratio" <= 1)),
	CONSTRAINT "utilization_snapshots_available_value" CHECK ("utilization_snapshots"."status" <> 'AVAILABLE' or "utilization_snapshots"."utilization_ratio" is not null),
	CONSTRAINT "utilization_snapshots_unavailable_null" CHECK ("utilization_snapshots"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or "utilization_snapshots"."utilization_ratio" is null)
);
--> statement-breakpoint
CREATE TABLE "yield_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"selection_policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_apy" numeric(24, 18),
	"incentive_apy" numeric(24, 18),
	"gross_apy" numeric(24, 18),
	"net_apy" numeric(24, 18),
	"comparative_risk_adjusted_apy" numeric(24, 18),
	"calculation_version" varchar(64) NOT NULL,
	"calculation_inputs" jsonb NOT NULL,
	"is_variable" boolean NOT NULL,
	"is_promotional" boolean NOT NULL,
	"promotion_ends_at" timestamp with time zone,
	CONSTRAINT "yield_snapshots_observation_calculation_unique" UNIQUE("source_observation_id","calculation_version"),
	CONSTRAINT "yield_snapshots_exactly_one_parent" CHECK (num_nonnulls("yield_snapshots"."product_id", "yield_snapshots"."route_id") = 1),
	CONSTRAINT "yield_snapshots_inputs_object" CHECK (jsonb_typeof("yield_snapshots"."calculation_inputs") = 'object'),
	CONSTRAINT "yield_snapshots_available_has_value" CHECK ("yield_snapshots"."status" <> 'AVAILABLE' or num_nonnulls("yield_snapshots"."base_apy", "yield_snapshots"."incentive_apy", "yield_snapshots"."gross_apy", "yield_snapshots"."net_apy", "yield_snapshots"."comparative_risk_adjusted_apy") > 0),
	CONSTRAINT "yield_snapshots_unavailable_has_no_value" CHECK ("yield_snapshots"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or num_nonnulls("yield_snapshots"."base_apy", "yield_snapshots"."incentive_apy", "yield_snapshots"."gross_apy", "yield_snapshots"."net_apy", "yield_snapshots"."comparative_risk_adjusted_apy") = 0),
	CONSTRAINT "yield_snapshots_promotion_expiry" CHECK (not "yield_snapshots"."is_promotional" or "yield_snapshots"."promotion_ends_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "administrators" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mfa_enforced" boolean DEFAULT false NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administrators_approval_pair" CHECK (("administrators"."approved_by_user_id" is null) = ("administrators"."approved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "role_code" NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_session_id_hash" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"recent_auth_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(128),
	CONSTRAINT "sessions_provider_hash_unique" UNIQUE("provider_session_id_hash"),
	CONSTRAINT "sessions_expiry_after_create" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_revocation_reason_present" CHECK ("sessions"."revoked_at" is null or btrim("sessions"."revocation_reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"risk_profile" varchar(32) DEFAULT 'BALANCED' NOT NULL,
	"accepts_kyc_routes" boolean,
	"accepts_incentive_yield" boolean,
	"default_holding_period_days" integer,
	"display_currency_asset_id" uuid,
	"presentation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_timezone_not_blank" CHECK (btrim("user_preferences"."timezone") <> ''),
	CONSTRAINT "user_preferences_holding_period_positive" CHECK ("user_preferences"."default_holding_period_days" is null or "user_preferences"."default_holding_period_days" > 0),
	CONSTRAINT "user_preferences_presentation_object" CHECK (jsonb_typeof("user_preferences"."presentation") = 'object')
);
--> statement-breakpoint
CREATE TABLE "user_preferred_assets" (
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferred_assets_pk" PRIMARY KEY("user_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferred_chains" (
	"user_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferred_chains_pk" PRIMARY KEY("user_id","chain_id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"jurisdiction_id" uuid,
	"investor_classification" "investor_classification" DEFAULT 'UNKNOWN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_display_name_not_blank" CHECK ("user_profiles"."display_name" is null or btrim("user_profiles"."display_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_roles_pk" PRIMARY KEY("user_id","role_id"),
	CONSTRAINT "user_roles_expiry_after_grant" CHECK ("user_roles"."expires_at" is null or "user_roles"."expires_at" > "user_roles"."granted_at"),
	CONSTRAINT "user_roles_revoke_after_grant" CHECK ("user_roles"."revoked_at" is null or "user_roles"."revoked_at" >= "user_roles"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" varchar(64) NOT NULL,
	"auth_subject_id" text NOT NULL,
	"email" text,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_provider","auth_subject_id"),
	CONSTRAINT "users_auth_provider_not_blank" CHECK (btrim("users"."auth_provider") <> ''),
	CONSTRAINT "users_auth_subject_not_blank" CHECK (btrim("users"."auth_subject_id") <> ''),
	CONSTRAINT "users_disabled_timestamp" CHECK ("users"."status" <> 'DISABLED' or "users"."disabled_at" is not null),
	CONSTRAINT "users_anonymized_timestamp" CHECK ("users"."status" <> 'ANONYMIZED' or "users"."anonymized_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"asset_type" varchar(64) NOT NULL,
	"currency_code" varchar(8),
	"decimals" integer,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "assets_symbol_type_unique" UNIQUE("symbol","asset_type"),
	CONSTRAINT "assets_symbol_not_blank" CHECK (btrim("assets"."symbol") <> ''),
	CONSTRAINT "assets_decimals_range" CHECK ("assets"."decimals" is null or ("assets"."decimals" >= 0 and "assets"."decimals" <= 255))
);
--> statement-breakpoint
CREATE TABLE "auditors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"official_url" text,
	"jurisdiction_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "auditors_name_unique" UNIQUE("name"),
	CONSTRAINT "auditors_name_not_blank" CHECK (btrim("auditors"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caip2_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"native_asset_id" uuid,
	"explorer_base_url" text,
	"finality_blocks" integer,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "chains_caip2_id_unique" UNIQUE("caip2_id"),
	CONSTRAINT "chains_caip2_not_blank" CHECK (btrim("chains"."caip2_id") <> ''),
	CONSTRAINT "chains_explorer_https" CHECK ("chains"."explorer_base_url" is null or "chains"."explorer_base_url" ~ '^https://'),
	CONSTRAINT "chains_finality_nonnegative" CHECK ("chains"."finality_blocks" is null or "chains"."finality_blocks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"address" text NOT NULL,
	"normalized_address" text NOT NULL,
	"contract_type" varchar(64) NOT NULL,
	"explorer_url" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"deployment_block" numeric(78, 0),
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contracts_chain_address_unique" UNIQUE("chain_id","normalized_address"),
	CONSTRAINT "contracts_address_not_blank" CHECK (btrim("contracts"."address") <> ''),
	CONSTRAINT "contracts_verified_timestamp" CHECK (not "contracts"."is_verified" or "contracts"."verified_at" is not null),
	CONSTRAINT "contracts_deployment_block_nonnegative" CHECK ("contracts"."deployment_block" is null or "contracts"."deployment_block" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"official_url" text,
	"jurisdiction_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "custodians_name_unique" UNIQUE("name"),
	CONSTRAINT "custodians_name_not_blank" CHECK (btrim("custodians"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "issuers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"official_url" text,
	"jurisdiction_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "issuers_name_unique" UNIQUE("name"),
	CONSTRAINT "issuers_name_not_blank" CHECK (btrim("issuers"."name") <> ''),
	CONSTRAINT "issuers_official_url_https" CHECK ("issuers"."official_url" is null or "issuers"."official_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso_code" varchar(3) NOT NULL,
	"name" text NOT NULL,
	"subdivision_code" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "jurisdictions_iso_subdivision_unique" UNIQUE("iso_code","subdivision_code"),
	CONSTRAINT "jurisdictions_iso_code_uppercase" CHECK ("jurisdictions"."iso_code" = upper("jurisdictions"."iso_code")),
	CONSTRAINT "jurisdictions_name_not_blank" CHECK (btrim("jurisdictions"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "oracles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"official_url" text,
	"jurisdiction_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "oracles_name_unique" UNIQUE("name"),
	CONSTRAINT "oracles_name_not_blank" CHECK (btrim("oracles"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "product_category_code" NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_contracts" (
	"product_id" uuid NOT NULL,
	"route_id" uuid,
	"contract_id" uuid NOT NULL,
	"relationship_type" varchar(64) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_contracts_pk" PRIMARY KEY("product_id","contract_id","relationship_type","effective_from"),
	CONSTRAINT "product_contracts_relationship_not_blank" CHECK (btrim("product_contracts"."relationship_type") <> ''),
	CONSTRAINT "product_contracts_effective_interval" CHECK ("product_contracts"."effective_to" is null or "product_contracts"."effective_to" > "product_contracts"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "product_return_exposures" (
	"product_id" uuid NOT NULL,
	"return_exposure_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_return_exposures_pk" PRIMARY KEY("product_id","return_exposure_id")
);
--> statement-breakpoint
CREATE TABLE "product_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"protocol_id" uuid,
	"chain_id" uuid,
	"deposit_asset_id" uuid,
	"receipt_asset_id" uuid,
	"name" text NOT NULL,
	"access_method" "access_method" NOT NULL,
	"is_native" boolean DEFAULT false NOT NULL,
	"requires_kyc" boolean,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "product_routes_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "product_routes_version_positive" CHECK ("product_routes"."version" > 0),
	CONSTRAINT "product_routes_name_not_blank" CHECK (btrim("product_routes"."name") <> ''),
	CONSTRAINT "product_routes_effective_interval" CHECK ("product_routes"."effective_to" is null or "product_routes"."effective_to" > "product_routes"."effective_from"),
	CONSTRAINT "product_routes_native_method" CHECK (not "product_routes"."is_native" or "product_routes"."access_method" = 'NATIVE_HOLD')
);
--> statement-breakpoint
CREATE TABLE "product_yield_sources" (
	"product_id" uuid,
	"route_id" uuid,
	"yield_source_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_yield_sources_pk" PRIMARY KEY("yield_source_id","effective_from"),
	CONSTRAINT "product_yield_sources_exactly_one_parent" CHECK (num_nonnulls("product_yield_sources"."product_id", "product_yield_sources"."route_id") = 1),
	CONSTRAINT "product_yield_sources_effective_interval" CHECK ("product_yield_sources"."effective_to" is null or "product_yield_sources"."effective_to" > "product_yield_sources"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"category_id" uuid NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"issuer_id" uuid,
	"name" text NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"description" text,
	"denomination_asset_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "products_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "products_version_positive" CHECK ("products"."version" > 0),
	CONSTRAINT "products_name_not_blank" CHECK (btrim("products"."name") <> ''),
	CONSTRAINT "products_symbol_not_blank" CHECK (btrim("products"."symbol") <> ''),
	CONSTRAINT "products_effective_interval" CHECK ("products"."effective_to" is null or "products"."effective_to" > "products"."effective_from"),
	CONSTRAINT "products_published_timestamp" CHECK ("products"."publication_status" <> 'PUBLISHED' or "products"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"official_url" text,
	"jurisdiction_id" uuid,
	"lifecycle_status" "lifecycle_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "protocols_name_unique" UNIQUE("name"),
	CONSTRAINT "protocols_name_not_blank" CHECK (btrim("protocols"."name") <> ''),
	CONSTRAINT "protocols_official_url_https" CHECK ("protocols"."official_url" is null or "protocols"."official_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "return_exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_exposures_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stablecoins" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"peg_asset_id" uuid,
	"peg_currency_code" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stablecoins_exactly_one_peg" CHECK (num_nonnulls("stablecoins"."peg_asset_id", "stablecoins"."peg_currency_code") = 1)
);
--> statement-breakpoint
CREATE TABLE "yield_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_class" "yield_source_class" NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_incentive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "yield_sources_class_name_unique" UNIQUE("source_class","name"),
	CONSTRAINT "yield_sources_name_not_blank" CHECK (btrim("yield_sources"."name") <> ''),
	CONSTRAINT "yield_sources_no_native_not_incentive" CHECK ("yield_sources"."source_class" <> 'NO_NATIVE_YIELD' or not "yield_sources"."is_incentive")
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" varchar(96) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_record_version" integer NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"reason" text NOT NULL,
	"source_id" uuid,
	"verification_date" timestamp with time zone,
	"outcome" "review_outcome" NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_logs_action_not_blank" CHECK (btrim("admin_audit_logs"."action") <> ''),
	CONSTRAINT "admin_audit_logs_target_type_not_blank" CHECK (btrim("admin_audit_logs"."target_type") <> ''),
	CONSTRAINT "admin_audit_logs_record_version_positive" CHECK ("admin_audit_logs"."target_record_version" > 0),
	CONSTRAINT "admin_audit_logs_change_present" CHECK (num_nonnulls("admin_audit_logs"."before_value", "admin_audit_logs"."after_value") > 0),
	CONSTRAINT "admin_audit_logs_reason_not_blank" CHECK (btrim("admin_audit_logs"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "data_deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"backup_expiry_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_deletion_receipts_request_hash_unique" UNIQUE("request_hash"),
	CONSTRAINT "data_deletion_receipts_backup_expiry" CHECK ("data_deletion_receipts"."backup_expiry_at" >= "data_deletion_receipts"."completed_at")
);
--> statement-breakpoint
CREATE TABLE "dead_letter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_run_id" uuid NOT NULL,
	"payload_version" varchar(64) NOT NULL,
	"redacted_payload" jsonb NOT NULL,
	"error_category" varchar(96) NOT NULL,
	"replay_outcome" "review_outcome" DEFAULT 'PENDING' NOT NULL,
	"replayed_by_user_id" uuid,
	"replayed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dead_letter_jobs_job_run_unique" UNIQUE("job_run_id"),
	CONSTRAINT "dead_letter_jobs_payload_object" CHECK (jsonb_typeof("dead_letter_jobs"."redacted_payload") = 'object'),
	CONSTRAINT "dead_letter_jobs_replay_pair" CHECK (("dead_letter_jobs"."replayed_by_user_id" is null) = ("dead_letter_jobs"."replayed_at" is null)),
	CONSTRAINT "dead_letter_jobs_expiry_after_create" CHECK ("dead_letter_jobs"."expires_at" > "dead_letter_jobs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(96) NOT NULL,
	"payload_version" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_category" varchar(96),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_outbox_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "job_outbox_topic_not_blank" CHECK (btrim("job_outbox"."topic") <> ''),
	CONSTRAINT "job_outbox_payload_object" CHECK (jsonb_typeof("job_outbox"."payload") = 'object'),
	CONSTRAINT "job_outbox_attempts_nonnegative" CHECK ("job_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(96) NOT NULL,
	"job_version" varchar(64) NOT NULL,
	"payload_version" varchar(64) NOT NULL,
	"source_id" uuid,
	"idempotency_key" varchar(128) NOT NULL,
	"status" "job_status" NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"producer_identity" varchar(96) NOT NULL,
	"requested_by_user_id" uuid,
	"correlation_id" uuid NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"records_read" integer DEFAULT 0 NOT NULL,
	"records_accepted" integer DEFAULT 0 NOT NULL,
	"records_rejected" integer DEFAULT 0 NOT NULL,
	"records_changed" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"dead_letter_count" integer DEFAULT 0 NOT NULL,
	"fresh_record_count" integer DEFAULT 0 NOT NULL,
	"stale_record_count" integer DEFAULT 0 NOT NULL,
	"error_category" varchar(96),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_runs_idempotency_attempt_unique" UNIQUE("idempotency_key","attempt"),
	CONSTRAINT "job_runs_name_not_blank" CHECK (btrim("job_runs"."job_name") <> ''),
	CONSTRAINT "job_runs_attempt_range" CHECK ("job_runs"."attempt" > 0 and "job_runs"."attempt" <= "job_runs"."max_attempts"),
	CONSTRAINT "job_runs_counts_nonnegative" CHECK ("job_runs"."records_read" >= 0 and "job_runs"."records_accepted" >= 0 and "job_runs"."records_rejected" >= 0 and "job_runs"."records_changed" >= 0 and "job_runs"."retry_count" >= 0 and "job_runs"."dead_letter_count" >= 0 and "job_runs"."fresh_record_count" >= 0 and "job_runs"."stale_record_count" >= 0),
	CONSTRAINT "job_runs_start_state" CHECK ("job_runs"."status" in ('QUEUED', 'CANCELLED') or "job_runs"."started_at" is not null),
	CONSTRAINT "job_runs_completion_state" CHECK ("job_runs"."status" in ('QUEUED', 'RUNNING') or "job_runs"."completed_at" is not null),
	CONSTRAINT "job_runs_time_order" CHECK (("job_runs"."started_at" is null or "job_runs"."started_at" >= "job_runs"."queued_at") and ("job_runs"."completed_at" is null or ("job_runs"."started_at" is not null and "job_runs"."completed_at" >= "job_runs"."started_at")))
);
--> statement-breakpoint
CREATE TABLE "security_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"event_type" varchar(96) NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"subject_hash" varchar(128),
	"network_address_hash" varchar(128),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_audit_events_type_not_blank" CHECK (btrim("security_audit_events"."event_type") <> ''),
	CONSTRAINT "security_audit_events_details_object" CHECK (jsonb_typeof("security_audit_events"."details") = 'object'),
	CONSTRAINT "security_audit_events_expiry_after_event" CHECK ("security_audit_events"."expires_at" > "security_audit_events"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "adapter_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"adapter_version" varchar(64) NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	"duration_ms" bigint NOT NULL,
	"records_read" integer DEFAULT 0 NOT NULL,
	"records_accepted" integer DEFAULT 0 NOT NULL,
	"records_rejected" integer DEFAULT 0 NOT NULL,
	"records_changed" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"dead_letter_count" integer DEFAULT 0 NOT NULL,
	"fresh_record_count" integer DEFAULT 0 NOT NULL,
	"stale_record_count" integer DEFAULT 0 NOT NULL,
	"error_category" varchar(96),
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adapter_health_duration_nonnegative" CHECK ("adapter_health"."duration_ms" >= 0),
	CONSTRAINT "adapter_health_counts_nonnegative" CHECK ("adapter_health"."records_read" >= 0 and "adapter_health"."records_accepted" >= 0 and "adapter_health"."records_rejected" >= 0 and "adapter_health"."records_changed" >= 0 and "adapter_health"."retry_count" >= 0 and "adapter_health"."dead_letter_count" >= 0 and "adapter_health"."fresh_record_count" >= 0 and "adapter_health"."stale_record_count" >= 0),
	CONSTRAINT "adapter_health_success_timestamp" CHECK ("adapter_health"."outcome" <> 'APPROVED' or "adapter_health"."succeeded_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"auditor_id" uuid NOT NULL,
	"audit_type" varchar(64) NOT NULL,
	"report_url" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"opinion" text,
	CONSTRAINT "audit_records_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "audit_records_exactly_one_parent" CHECK (num_nonnulls("audit_records"."product_id", "audit_records"."route_id") = 1),
	CONSTRAINT "audit_records_report_https" CHECK ("audit_records"."report_url" ~ '^https://'),
	CONSTRAINT "audit_records_period_order" CHECK ("audit_records"."period_end" is null or ("audit_records"."period_start" is not null and "audit_records"."period_end" >= "audit_records"."period_start"))
);
--> statement-breakpoint
CREATE TABLE "custody_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"custodian_id" uuid NOT NULL,
	"custody_type" varchar(64) NOT NULL,
	"description" text,
	CONSTRAINT "custody_records_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "custody_records_exactly_one_parent" CHECK (num_nonnulls("custody_records"."product_id", "custody_records"."route_id") = 1),
	CONSTRAINT "custody_records_type_not_blank" CHECK (btrim("custody_records"."custody_type") <> ''),
	CONSTRAINT "custody_records_effective_interval" CHECK ("custody_records"."effective_to" is null or "custody_records"."effective_to" > "custody_records"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "data_quality_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "quality_event_type" NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"metric" varchar(96),
	"primary_observation_id" uuid,
	"competing_observation_id" uuid,
	"severity" varchar(16) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_quality_events_entity_type_not_blank" CHECK (btrim("data_quality_events"."entity_type") <> ''),
	CONSTRAINT "data_quality_events_resolution_pair" CHECK (("data_quality_events"."resolved_at" is null and "data_quality_events"."resolution" is null) or ("data_quality_events"."resolved_at" is not null and btrim("data_quality_events"."resolution") <> '')),
	CONSTRAINT "data_quality_events_resolution_order" CHECK ("data_quality_events"."resolved_at" is null or "data_quality_events"."resolved_at" >= "data_quality_events"."detected_at")
);
--> statement-breakpoint
CREATE TABLE "eligibility_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"jurisdiction_id" uuid NOT NULL,
	"investor_classification" "investor_classification" NOT NULL,
	"eligibility_status" "eligibility_status" NOT NULL,
	"requires_kyc" boolean,
	"conditions_text" text,
	CONSTRAINT "eligibility_rules_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "eligibility_rules_version_positive" CHECK ("eligibility_rules"."version" > 0),
	CONSTRAINT "eligibility_rules_exactly_one_parent" CHECK (num_nonnulls("eligibility_rules"."product_id", "eligibility_rules"."route_id") = 1),
	CONSTRAINT "eligibility_rules_effective_interval" CHECK ("eligibility_rules"."effective_to" is null or "eligibility_rules"."effective_to" > "eligibility_rules"."effective_from"),
	CONSTRAINT "eligibility_rules_conditional_explanation" CHECK ("eligibility_rules"."eligibility_status" <> 'CONDITIONAL' or btrim("eligibility_rules"."conditions_text") <> '')
);
--> statement-breakpoint
CREATE TABLE "proof_of_reserve_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"oracle_id" uuid,
	"reserve_ratio" numeric(24, 18),
	"attestation_url" text,
	"description" text NOT NULL,
	CONSTRAINT "proof_of_reserve_records_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "proof_of_reserve_records_exactly_one_parent" CHECK (num_nonnulls("proof_of_reserve_records"."product_id", "proof_of_reserve_records"."route_id") = 1),
	CONSTRAINT "proof_of_reserve_ratio_nonnegative" CHECK ("proof_of_reserve_records"."reserve_ratio" is null or "proof_of_reserve_records"."reserve_ratio" >= 0),
	CONSTRAINT "proof_of_reserve_attestation_https" CHECK ("proof_of_reserve_records"."attestation_url" is null or "proof_of_reserve_records"."attestation_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "redemption_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"minimum_amount" numeric(38, 18),
	"minimum_amount_asset_id" uuid,
	"notice_period_hours" numeric(20, 6),
	"settlement_period_hours" numeric(20, 6),
	"window_description" text,
	"gates_possible" boolean,
	"in_kind_possible" boolean,
	CONSTRAINT "redemption_terms_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "redemption_terms_version_positive" CHECK ("redemption_terms"."version" > 0),
	CONSTRAINT "redemption_terms_exactly_one_parent" CHECK (num_nonnulls("redemption_terms"."product_id", "redemption_terms"."route_id") = 1),
	CONSTRAINT "redemption_terms_effective_interval" CHECK ("redemption_terms"."effective_to" is null or "redemption_terms"."effective_to" > "redemption_terms"."effective_from"),
	CONSTRAINT "redemption_terms_minimum_nonnegative" CHECK ("redemption_terms"."minimum_amount" is null or "redemption_terms"."minimum_amount" >= 0),
	CONSTRAINT "redemption_terms_amount_unit_pair" CHECK (("redemption_terms"."minimum_amount" is null) = ("redemption_terms"."minimum_amount_asset_id" is null)),
	CONSTRAINT "redemption_terms_periods_nonnegative" CHECK (("redemption_terms"."notice_period_hours" is null or "redemption_terms"."notice_period_hours" >= 0) and ("redemption_terms"."settlement_period_hours" is null or "redemption_terms"."settlement_period_hours" >= 0))
);
--> statement-breakpoint
CREATE TABLE "source_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_entity_id" text NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid,
	"metric" varchar(96) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"confidence" "confidence_class" NOT NULL,
	"status" "data_status" NOT NULL,
	"value_type" "observation_value_type" NOT NULL,
	"raw_value" jsonb,
	"raw_value_expires_at" timestamp with time zone,
	"normalized_numeric_value" numeric(38, 18),
	"normalized_text_value" text,
	"normalized_boolean_value" boolean,
	"normalized_json_value" jsonb,
	"unit" varchar(64) NOT NULL,
	"source_revision" text NOT NULL,
	"adapter_version" varchar(64) NOT NULL,
	"provenance_hash" varchar(128) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_observations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "source_observations_provenance_hash_unique" UNIQUE("provenance_hash"),
	CONSTRAINT "source_observations_external_entity_not_blank" CHECK (btrim("source_observations"."external_entity_id") <> ''),
	CONSTRAINT "source_observations_entity_type_not_blank" CHECK (btrim("source_observations"."entity_type") <> ''),
	CONSTRAINT "source_observations_metric_not_blank" CHECK (btrim("source_observations"."metric") <> ''),
	CONSTRAINT "source_observations_unit_not_blank" CHECK (btrim("source_observations"."unit") <> ''),
	CONSTRAINT "source_observations_time_order" CHECK ("source_observations"."fetched_at" >= "source_observations"."observed_at" and ("source_observations"."verified_at" is null or "source_observations"."verified_at" >= "source_observations"."observed_at")),
	CONSTRAINT "source_observations_raw_expiry_order" CHECK ("source_observations"."raw_value_expires_at" is null or "source_observations"."raw_value_expires_at" > "source_observations"."fetched_at"),
	CONSTRAINT "source_observations_value_shape" CHECK ((
        ("source_observations"."value_type" = 'NUMERIC' and "source_observations"."normalized_numeric_value" is not null and num_nonnulls("source_observations"."normalized_text_value", "source_observations"."normalized_boolean_value", "source_observations"."normalized_json_value") = 0)
        or ("source_observations"."value_type" = 'TEXT' and "source_observations"."normalized_text_value" is not null and num_nonnulls("source_observations"."normalized_numeric_value", "source_observations"."normalized_boolean_value", "source_observations"."normalized_json_value") = 0)
        or ("source_observations"."value_type" = 'BOOLEAN' and "source_observations"."normalized_boolean_value" is not null and num_nonnulls("source_observations"."normalized_numeric_value", "source_observations"."normalized_text_value", "source_observations"."normalized_json_value") = 0)
        or ("source_observations"."value_type" = 'JSON' and "source_observations"."normalized_json_value" is not null and num_nonnulls("source_observations"."normalized_numeric_value", "source_observations"."normalized_text_value", "source_observations"."normalized_boolean_value") = 0)
        or ("source_observations"."value_type" = 'NONE' and num_nonnulls("source_observations"."normalized_numeric_value", "source_observations"."normalized_text_value", "source_observations"."normalized_boolean_value", "source_observations"."normalized_json_value") = 0)
      )),
	CONSTRAINT "source_observations_unavailable_has_no_value" CHECK ("source_observations"."status" not in ('UNAVAILABLE', 'UNKNOWN', 'AWAITING_VERIFICATION') or "source_observations"."value_type" = 'NONE')
);
--> statement-breakpoint
CREATE TABLE "source_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(96) NOT NULL,
	"name" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"canonical_url" text NOT NULL,
	"owner_name" text NOT NULL,
	"terms_url" text,
	"licence_name" text,
	"licence_url" text,
	"attribution_text" text,
	"rate_limit_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expected_cadence_seconds" integer,
	"freshness_threshold_seconds" integer,
	"priority" integer NOT NULL,
	"status" "source_status" DEFAULT 'ACTIVE' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"removal_procedure" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "source_registry_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "source_registry_code_version_unique" UNIQUE("code","version"),
	CONSTRAINT "source_registry_version_positive" CHECK ("source_registry"."version" > 0),
	CONSTRAINT "source_registry_code_not_blank" CHECK (btrim("source_registry"."code") <> ''),
	CONSTRAINT "source_registry_name_not_blank" CHECK (btrim("source_registry"."name") <> ''),
	CONSTRAINT "source_registry_canonical_https" CHECK ("source_registry"."canonical_url" ~ '^https://'),
	CONSTRAINT "source_registry_terms_https" CHECK ("source_registry"."terms_url" is null or "source_registry"."terms_url" ~ '^https://'),
	CONSTRAINT "source_registry_licence_https" CHECK ("source_registry"."licence_url" is null or "source_registry"."licence_url" ~ '^https://'),
	CONSTRAINT "source_registry_priority_nonnegative" CHECK ("source_registry"."priority" >= 0),
	CONSTRAINT "source_registry_cadence_positive" CHECK ("source_registry"."expected_cadence_seconds" is null or "source_registry"."expected_cadence_seconds" > 0),
	CONSTRAINT "source_registry_freshness_positive" CHECK ("source_registry"."freshness_threshold_seconds" is null or "source_registry"."freshness_threshold_seconds" > 0),
	CONSTRAINT "source_registry_rate_limit_object" CHECK (jsonb_typeof("source_registry"."rate_limit_policy") = 'object'),
	CONSTRAINT "source_registry_publication_timestamp" CHECK ("source_registry"."publication_status" <> 'PUBLISHED' or "source_registry"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "transfer_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"source_observation_id" uuid NOT NULL,
	"publication_status" "publication_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"transfers_allowed" boolean,
	"whitelist_required" boolean,
	"description" text NOT NULL,
	CONSTRAINT "transfer_restrictions_logical_version_unique" UNIQUE("logical_id","version"),
	CONSTRAINT "transfer_restrictions_exactly_one_parent" CHECK (num_nonnulls("transfer_restrictions"."product_id", "transfer_restrictions"."route_id") = 1),
	CONSTRAINT "transfer_restrictions_description_not_blank" CHECK (btrim("transfer_restrictions"."description") <> ''),
	CONSTRAINT "transfer_restrictions_effective_interval" CHECK ("transfer_restrictions"."effective_to" is null or "transfer_restrictions"."effective_to" > "transfer_restrictions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"deduplication_key" varchar(128) NOT NULL,
	"evaluation_version" varchar(64) NOT NULL,
	"observed_value" numeric(38, 18),
	"observed_unit" varchar(64),
	"payload" jsonb NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"suppressed_at" timestamp with time zone,
	"suppression_reason" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_events_deduplication_key_unique" UNIQUE("deduplication_key"),
	CONSTRAINT "alert_events_observed_pair" CHECK (("alert_events"."observed_value" is null) = ("alert_events"."observed_unit" is null)),
	CONSTRAINT "alert_events_payload_object" CHECK (jsonb_typeof("alert_events"."payload") = 'object'),
	CONSTRAINT "alert_events_suppression_pair" CHECK (("alert_events"."suppressed_at" is null and "alert_events"."suppression_reason" is null) or ("alert_events"."suppressed_at" is not null and btrim("alert_events"."suppression_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "alert_rule_destinations" (
	"alert_rule_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rule_destinations_pk" PRIMARY KEY("alert_rule_id","destination_id")
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"condition" "alert_condition" NOT NULL,
	"threshold" numeric(38, 18),
	"threshold_unit" varchar(64),
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"minimum_confidence" "confidence_class",
	"timezone" text NOT NULL,
	"cooldown_seconds" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "alert_rules_at_most_one_target" CHECK (num_nonnulls("alert_rules"."product_id", "alert_rules"."route_id") <= 1),
	CONSTRAINT "alert_rules_threshold_pair" CHECK (("alert_rules"."threshold" is null) = ("alert_rules"."threshold_unit" is null)),
	CONSTRAINT "alert_rules_timezone_not_blank" CHECK (btrim("alert_rules"."timezone") <> ''),
	CONSTRAINT "alert_rules_cooldown_nonnegative" CHECK ("alert_rules"."cooldown_seconds" >= 0),
	CONSTRAINT "alert_rules_configuration_object" CHECK (jsonb_typeof("alert_rules"."configuration") = 'object'),
	CONSTRAINT "alert_rules_unsubscribe_disabled" CHECK ("alert_rules"."unsubscribed_at" is null or not "alert_rules"."enabled")
);
--> statement-breakpoint
CREATE TABLE "linked_wallet_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"address_ciphertext" "bytea" NOT NULL,
	"address_hash" varchar(128) NOT NULL,
	"masked_address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "linked_wallet_addresses_user_chain_hash_unique" UNIQUE("user_id","chain_id","address_hash"),
	CONSTRAINT "linked_wallet_addresses_mask_not_blank" CHECK (btrim("linked_wallet_addresses"."masked_address") <> '')
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_event_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "delivery_status" NOT NULL,
	"provider_message_id_hash" varchar(128),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error_category" varchar(96),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_event_destination_unique" UNIQUE("alert_event_id","destination_id"),
	CONSTRAINT "notification_deliveries_attempts_nonnegative" CHECK ("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_delivered_timestamp" CHECK ("notification_deliveries"."status" <> 'DELIVERED' or "notification_deliveries"."delivered_at" is not null),
	CONSTRAINT "notification_deliveries_expiry_after_create" CHECK ("notification_deliveries"."expires_at" > "notification_deliveries"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"destination_ciphertext" "bytea",
	"destination_hash" varchar(128),
	"masked_label" text NOT NULL,
	"verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_destinations_user_hash_unique" UNIQUE("user_id","channel","destination_hash"),
	CONSTRAINT "notification_destinations_external_value" CHECK ("notification_destinations"."channel" in ('IN_APP', 'CONSOLE') or num_nonnulls("notification_destinations"."destination_ciphertext", "notification_destinations"."destination_hash") = 2),
	CONSTRAINT "notification_destinations_no_plaintext_label" CHECK (btrim("notification_destinations"."masked_label") <> '')
);
--> statement-breakpoint
CREATE TABLE "route_simulation_allocations" (
	"simulation_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"allocation_ratio" numeric(20, 18) NOT NULL,
	"allocated_amount" numeric(38, 18) NOT NULL,
	"gross_apy" numeric(24, 18),
	"net_apy" numeric(24, 18),
	"comparative_risk_adjusted_apy" numeric(24, 18),
	"risk_score" numeric(5, 2),
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_simulation_allocations_pk" PRIMARY KEY("simulation_id","route_id"),
	CONSTRAINT "route_simulation_allocations_ratio_range" CHECK ("route_simulation_allocations"."allocation_ratio" > 0 and "route_simulation_allocations"."allocation_ratio" <= 1),
	CONSTRAINT "route_simulation_allocations_amount_positive" CHECK ("route_simulation_allocations"."allocated_amount" > 0),
	CONSTRAINT "route_simulation_allocations_risk_range" CHECK ("route_simulation_allocations"."risk_score" is null or ("route_simulation_allocations"."risk_score" >= 0 and "route_simulation_allocations"."risk_score" <= 100)),
	CONSTRAINT "route_simulation_allocations_rationale_not_blank" CHECK (btrim("route_simulation_allocations"."rationale") <> '')
);
--> statement-breakpoint
CREATE TABLE "route_simulation_candidates" (
	"simulation_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"included" boolean NOT NULL,
	"exclusion_reason_code" varchar(96),
	"canonical_facts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_simulation_candidates_pk" PRIMARY KEY("simulation_id","route_id"),
	CONSTRAINT "route_simulation_candidates_ordinal_unique" UNIQUE("simulation_id","ordinal"),
	CONSTRAINT "route_simulation_candidates_ordinal_positive" CHECK ("route_simulation_candidates"."ordinal" > 0),
	CONSTRAINT "route_simulation_candidates_exclusion_reason" CHECK ("route_simulation_candidates"."included" or btrim("route_simulation_candidates"."exclusion_reason_code") <> ''),
	CONSTRAINT "route_simulation_candidates_facts_object" CHECK (jsonb_typeof("route_simulation_candidates"."canonical_facts") = 'object')
);
--> statement-breakpoint
CREATE TABLE "route_simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"is_saved" boolean DEFAULT false NOT NULL,
	"name" text,
	"capital_amount" numeric(38, 18) NOT NULL,
	"capital_asset_id" uuid NOT NULL,
	"origin_chain_id" uuid,
	"holding_period_days" numeric(20, 6) NOT NULL,
	"jurisdiction_id" uuid,
	"investor_classification" "investor_classification" NOT NULL,
	"risk_profile" varchar(32) NOT NULL,
	"canonical_constraints" jsonb NOT NULL,
	"data_cutoff" timestamp with time zone NOT NULL,
	"methodology_version_id" uuid NOT NULL,
	"solver_version" varchar(64) NOT NULL,
	"calculation_version" varchar(64) NOT NULL,
	"status" "simulation_status" NOT NULL,
	"allocation_total" numeric(20, 18),
	"gross_blended_apy" numeric(24, 18),
	"net_blended_apy" numeric(24, 18),
	"comparative_risk_adjusted_apy" numeric(24, 18),
	"weighted_risk_score" numeric(5, 2),
	"data_confidence_score" numeric(5, 2),
	"result_summary" jsonb,
	"infeasibility_diagnostics" jsonb,
	"disclosure_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "route_simulations_capital_positive" CHECK ("route_simulations"."capital_amount" > 0),
	CONSTRAINT "route_simulations_holding_period_positive" CHECK ("route_simulations"."holding_period_days" > 0),
	CONSTRAINT "route_simulations_saved_owner" CHECK (not "route_simulations"."is_saved" or "route_simulations"."user_id" is not null),
	CONSTRAINT "route_simulations_constraints_object" CHECK (jsonb_typeof("route_simulations"."canonical_constraints") = 'object'),
	CONSTRAINT "route_simulations_allocation_total" CHECK ("route_simulations"."status" <> 'FEASIBLE' or "route_simulations"."allocation_total" = 1.000000000000000000),
	CONSTRAINT "route_simulations_no_infeasible_allocation" CHECK ("route_simulations"."status" <> 'INFEASIBLE' or "route_simulations"."allocation_total" is null),
	CONSTRAINT "route_simulations_score_ranges" CHECK (("route_simulations"."weighted_risk_score" is null or ("route_simulations"."weighted_risk_score" >= 0 and "route_simulations"."weighted_risk_score" <= 100)) and ("route_simulations"."data_confidence_score" is null or ("route_simulations"."data_confidence_score" >= 0 and "route_simulations"."data_confidence_score" <= 100))),
	CONSTRAINT "route_simulations_completion" CHECK ("route_simulations"."status" = 'PENDING' or "route_simulations"."completed_at" is not null),
	CONSTRAINT "route_simulations_infeasible_diagnostics" CHECK ("route_simulations"."status" <> 'INFEASIBLE' or jsonb_typeof("route_simulations"."infeasibility_diagnostics") = 'object')
);
--> statement-breakpoint
CREATE TABLE "saved_comparison_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparison_id" uuid NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_comparison_items_position_unique" UNIQUE("comparison_id","position"),
	CONSTRAINT "saved_comparison_items_product_unique" UNIQUE("comparison_id","product_id"),
	CONSTRAINT "saved_comparison_items_route_unique" UNIQUE("comparison_id","route_id"),
	CONSTRAINT "saved_comparison_items_exactly_one_target" CHECK (num_nonnulls("saved_comparison_items"."product_id", "saved_comparison_items"."route_id") = 1),
	CONSTRAINT "saved_comparison_items_position_range" CHECK ("saved_comparison_items"."position" >= 1 and "saved_comparison_items"."position" <= 5)
);
--> statement-breakpoint
CREATE TABLE "saved_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "saved_comparisons_user_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "saved_comparisons_name_not_blank" CHECK (btrim("saved_comparisons"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"sort" jsonb NOT NULL,
	"visible_columns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "saved_views_user_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "saved_views_name_not_blank" CHECK (btrim("saved_views"."name") <> ''),
	CONSTRAINT "saved_views_filters_object" CHECK (jsonb_typeof("saved_views"."filters") = 'object'),
	CONSTRAINT "saved_views_sort_object" CHECK (jsonb_typeof("saved_views"."sort") = 'object'),
	CONSTRAINT "saved_views_visible_columns_array" CHECK (jsonb_typeof("saved_views"."visible_columns") = 'array')
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"product_id" uuid,
	"route_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_product_unique" UNIQUE("watchlist_id","product_id"),
	CONSTRAINT "watchlist_items_route_unique" UNIQUE("watchlist_id","route_id"),
	CONSTRAINT "watchlist_items_exactly_one_target" CHECK (num_nonnulls("watchlist_items"."product_id", "watchlist_items"."route_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "watchlists_user_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "watchlists_name_not_blank" CHECK (btrim("watchlists"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "apy_components" ADD CONSTRAINT "apy_components_yield_snapshot_id_yield_snapshots_id_fk" FOREIGN KEY ("yield_snapshot_id") REFERENCES "public"."yield_snapshots"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "apy_components" ADD CONSTRAINT "apy_components_yield_source_id_yield_sources_id_fk" FOREIGN KEY ("yield_source_id") REFERENCES "public"."yield_sources"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "apy_components" ADD CONSTRAINT "apy_components_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "composite_risk_snapshots" ADD CONSTRAINT "composite_risk_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "composite_risk_snapshots" ADD CONSTRAINT "composite_risk_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "composite_risk_snapshots" ADD CONSTRAINT "composite_risk_snapshots_methodology_version_id_risk_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."risk_methodology_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_fixed_amount_asset_id_assets_id_fk" FOREIGN KEY ("fixed_amount_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "liquidity_snapshots" ADD CONSTRAINT "liquidity_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "liquidity_snapshots" ADD CONSTRAINT "liquidity_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "liquidity_snapshots" ADD CONSTRAINT "liquidity_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "liquidity_snapshots" ADD CONSTRAINT "liquidity_snapshots_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nav_snapshots" ADD CONSTRAINT "nav_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nav_snapshots" ADD CONSTRAINT "nav_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nav_snapshots" ADD CONSTRAINT "nav_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "nav_snapshots" ADD CONSTRAINT "nav_snapshots_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_factor_evidence" ADD CONSTRAINT "risk_factor_evidence_risk_factor_snapshot_id_risk_factor_snapshots_id_fk" FOREIGN KEY ("risk_factor_snapshot_id") REFERENCES "public"."risk_factor_snapshots"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_factor_evidence" ADD CONSTRAINT "risk_factor_evidence_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_factor_snapshots" ADD CONSTRAINT "risk_factor_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_factor_snapshots" ADD CONSTRAINT "risk_factor_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_factor_snapshots" ADD CONSTRAINT "risk_factor_snapshots_methodology_version_id_risk_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."risk_methodology_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_methodology_category_weights" ADD CONSTRAINT "risk_methodology_category_weights_methodology_version_id_risk_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."risk_methodology_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_methodology_category_weights" ADD CONSTRAINT "risk_methodology_category_weights_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_methodology_versions" ADD CONSTRAINT "risk_methodology_versions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_methodology_versions" ADD CONSTRAINT "risk_methodology_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tvl_aum_snapshots" ADD CONSTRAINT "tvl_aum_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tvl_aum_snapshots" ADD CONSTRAINT "tvl_aum_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tvl_aum_snapshots" ADD CONSTRAINT "tvl_aum_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tvl_aum_snapshots" ADD CONSTRAINT "tvl_aum_snapshots_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "utilization_snapshots" ADD CONSTRAINT "utilization_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "utilization_snapshots" ADD CONSTRAINT "utilization_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "utilization_snapshots" ADD CONSTRAINT "utilization_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yield_snapshots" ADD CONSTRAINT "yield_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yield_snapshots" ADD CONSTRAINT "yield_snapshots_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yield_snapshots" ADD CONSTRAINT "yield_snapshots_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_display_currency_asset_id_assets_id_fk" FOREIGN KEY ("display_currency_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferred_assets" ADD CONSTRAINT "user_preferred_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferred_assets" ADD CONSTRAINT "user_preferred_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferred_chains" ADD CONSTRAINT "user_preferred_chains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preferred_chains" ADD CONSTRAINT "user_preferred_chains_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "auditors" ADD CONSTRAINT "auditors_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "chains" ADD CONSTRAINT "chains_native_asset_id_assets_id_fk" FOREIGN KEY ("native_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custodians" ADD CONSTRAINT "custodians_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "issuers" ADD CONSTRAINT "issuers_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oracles" ADD CONSTRAINT "oracles_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_contracts" ADD CONSTRAINT "product_contracts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_contracts" ADD CONSTRAINT "product_contracts_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_contracts" ADD CONSTRAINT "product_contracts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_return_exposures" ADD CONSTRAINT "product_return_exposures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_return_exposures" ADD CONSTRAINT "product_return_exposures_return_exposure_id_return_exposures_id_fk" FOREIGN KEY ("return_exposure_id") REFERENCES "public"."return_exposures"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_deposit_asset_id_assets_id_fk" FOREIGN KEY ("deposit_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_routes" ADD CONSTRAINT "product_routes_receipt_asset_id_assets_id_fk" FOREIGN KEY ("receipt_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD CONSTRAINT "product_yield_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD CONSTRAINT "product_yield_sources_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_yield_sources" ADD CONSTRAINT "product_yield_sources_yield_source_id_yield_sources_id_fk" FOREIGN KEY ("yield_source_id") REFERENCES "public"."yield_sources"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_primary_asset_id_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_issuer_id_issuers_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_denomination_asset_id_assets_id_fk" FOREIGN KEY ("denomination_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stablecoins" ADD CONSTRAINT "stablecoins_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stablecoins" ADD CONSTRAINT "stablecoins_peg_asset_id_assets_id_fk" FOREIGN KEY ("peg_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_replayed_by_user_id_users_id_fk" FOREIGN KEY ("replayed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "adapter_health" ADD CONSTRAINT "adapter_health_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_auditor_id_auditors_id_fk" FOREIGN KEY ("auditor_id") REFERENCES "public"."auditors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custody_records" ADD CONSTRAINT "custody_records_custodian_id_custodians_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."custodians"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "data_quality_events" ADD CONSTRAINT "data_quality_events_primary_observation_id_source_observations_id_fk" FOREIGN KEY ("primary_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "data_quality_events" ADD CONSTRAINT "data_quality_events_competing_observation_id_source_observations_id_fk" FOREIGN KEY ("competing_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "data_quality_events" ADD CONSTRAINT "data_quality_events_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eligibility_rules" ADD CONSTRAINT "eligibility_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eligibility_rules" ADD CONSTRAINT "eligibility_rules_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eligibility_rules" ADD CONSTRAINT "eligibility_rules_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eligibility_rules" ADD CONSTRAINT "eligibility_rules_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "proof_of_reserve_records" ADD CONSTRAINT "proof_of_reserve_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "proof_of_reserve_records" ADD CONSTRAINT "proof_of_reserve_records_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "proof_of_reserve_records" ADD CONSTRAINT "proof_of_reserve_records_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "proof_of_reserve_records" ADD CONSTRAINT "proof_of_reserve_records_oracle_id_oracles_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "redemption_terms" ADD CONSTRAINT "redemption_terms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "redemption_terms" ADD CONSTRAINT "redemption_terms_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "redemption_terms" ADD CONSTRAINT "redemption_terms_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transfer_restrictions" ADD CONSTRAINT "transfer_restrictions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transfer_restrictions" ADD CONSTRAINT "transfer_restrictions_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transfer_restrictions" ADD CONSTRAINT "transfer_restrictions_source_observation_id_source_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."source_observations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_rule_destinations" ADD CONSTRAINT "alert_rule_destinations_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_rule_destinations" ADD CONSTRAINT "alert_rule_destinations_destination_id_notification_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."notification_destinations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "linked_wallet_addresses" ADD CONSTRAINT "linked_wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "linked_wallet_addresses" ADD CONSTRAINT "linked_wallet_addresses_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_event_id_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."alert_events"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_destination_id_notification_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."notification_destinations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_destinations" ADD CONSTRAINT "notification_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulation_allocations" ADD CONSTRAINT "route_simulation_allocations_simulation_id_route_simulations_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."route_simulations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulation_allocations" ADD CONSTRAINT "route_simulation_allocations_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulation_candidates" ADD CONSTRAINT "route_simulation_candidates_simulation_id_route_simulations_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."route_simulations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulation_candidates" ADD CONSTRAINT "route_simulation_candidates_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulations" ADD CONSTRAINT "route_simulations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulations" ADD CONSTRAINT "route_simulations_capital_asset_id_assets_id_fk" FOREIGN KEY ("capital_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulations" ADD CONSTRAINT "route_simulations_origin_chain_id_chains_id_fk" FOREIGN KEY ("origin_chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulations" ADD CONSTRAINT "route_simulations_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "route_simulations" ADD CONSTRAINT "route_simulations_methodology_version_id_risk_methodology_versions_id_fk" FOREIGN KEY ("methodology_version_id") REFERENCES "public"."risk_methodology_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_comparison_items" ADD CONSTRAINT "saved_comparison_items_comparison_id_saved_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."saved_comparisons"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_comparison_items" ADD CONSTRAINT "saved_comparison_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_comparison_items" ADD CONSTRAINT "saved_comparison_items_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_comparisons" ADD CONSTRAINT "saved_comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_route_id_product_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."product_routes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "composite_risk_snapshots_route_time_idx" ON "composite_risk_snapshots" USING btree ("route_id","calculated_at");--> statement-breakpoint
CREATE INDEX "composite_risk_snapshots_product_time_idx" ON "composite_risk_snapshots" USING btree ("product_id","calculated_at");--> statement-breakpoint
CREATE INDEX "fee_schedules_target_time_idx" ON "fee_schedules" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "liquidity_snapshots_route_time_idx" ON "liquidity_snapshots" USING btree ("route_id","as_of");--> statement-breakpoint
CREATE INDEX "liquidity_snapshots_product_time_idx" ON "liquidity_snapshots" USING btree ("product_id","as_of");--> statement-breakpoint
CREATE INDEX "nav_snapshots_route_time_idx" ON "nav_snapshots" USING btree ("route_id","as_of");--> statement-breakpoint
CREATE INDEX "nav_snapshots_product_time_idx" ON "nav_snapshots" USING btree ("product_id","as_of");--> statement-breakpoint
CREATE INDEX "price_snapshots_route_time_idx" ON "price_snapshots" USING btree ("route_id","as_of");--> statement-breakpoint
CREATE INDEX "price_snapshots_product_time_idx" ON "price_snapshots" USING btree ("product_id","as_of");--> statement-breakpoint
CREATE INDEX "risk_factor_snapshots_route_time_idx" ON "risk_factor_snapshots" USING btree ("route_id","calculated_at");--> statement-breakpoint
CREATE INDEX "risk_factor_snapshots_product_time_idx" ON "risk_factor_snapshots" USING btree ("product_id","calculated_at");--> statement-breakpoint
CREATE INDEX "risk_methodology_versions_publication_time_idx" ON "risk_methodology_versions" USING btree ("publication_status","effective_from");--> statement-breakpoint
CREATE INDEX "tvl_aum_snapshots_route_time_idx" ON "tvl_aum_snapshots" USING btree ("route_id","metric_kind","as_of");--> statement-breakpoint
CREATE INDEX "tvl_aum_snapshots_product_time_idx" ON "tvl_aum_snapshots" USING btree ("product_id","metric_kind","as_of");--> statement-breakpoint
CREATE INDEX "utilization_snapshots_route_time_idx" ON "utilization_snapshots" USING btree ("route_id","as_of");--> statement-breakpoint
CREATE INDEX "yield_snapshots_route_time_idx" ON "yield_snapshots" USING btree ("route_id","as_of");--> statement-breakpoint
CREATE INDEX "yield_snapshots_product_time_idx" ON "yield_snapshots" USING btree ("product_id","as_of");--> statement-breakpoint
CREATE INDEX "yield_snapshots_sortable_idx" ON "yield_snapshots" USING btree ("status","net_apy","as_of");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "user_roles_active_lookup_idx" ON "user_roles" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_contracts_route_idx" ON "product_contracts" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "product_routes_product_status_idx" ON "product_routes" USING btree ("product_id","publication_status","lifecycle_status");--> statement-breakpoint
CREATE INDEX "product_routes_protocol_chain_idx" ON "product_routes" USING btree ("protocol_id","chain_id");--> statement-breakpoint
CREATE INDEX "product_yield_sources_product_idx" ON "product_yield_sources" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_yield_sources_route_idx" ON "product_yield_sources" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "products" USING btree ("category_id","publication_status","lifecycle_status");--> statement-breakpoint
CREATE INDEX "products_issuer_idx" ON "products" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_actor_time_idx" ON "admin_audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_time_idx" ON "admin_audit_logs" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_correlation_idx" ON "admin_audit_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "dead_letter_jobs_expiry_idx" ON "dead_letter_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_outbox_pending_idx" ON "job_outbox" USING btree ("published_at","available_at");--> statement-breakpoint
CREATE INDEX "job_runs_status_queue_idx" ON "job_runs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "job_runs_source_time_idx" ON "job_runs" USING btree ("source_id","queued_at");--> statement-breakpoint
CREATE INDEX "job_runs_correlation_idx" ON "job_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "security_audit_events_type_time_idx" ON "security_audit_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "security_audit_events_actor_time_idx" ON "security_audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "adapter_health_source_attempt_idx" ON "adapter_health" USING btree ("source_id","attempted_at");--> statement-breakpoint
CREATE INDEX "audit_records_target_time_idx" ON "audit_records" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "custody_records_target_time_idx" ON "custody_records" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "data_quality_events_open_idx" ON "data_quality_events" USING btree ("resolved_at","severity","detected_at");--> statement-breakpoint
CREATE INDEX "data_quality_events_entity_idx" ON "data_quality_events" USING btree ("entity_type","entity_id","detected_at");--> statement-breakpoint
CREATE INDEX "eligibility_rules_target_lookup_idx" ON "eligibility_rules" USING btree ("product_id","route_id","jurisdiction_id","investor_classification","effective_from");--> statement-breakpoint
CREATE INDEX "proof_of_reserve_records_target_time_idx" ON "proof_of_reserve_records" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "redemption_terms_target_time_idx" ON "redemption_terms" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "source_observations_entity_metric_time_idx" ON "source_observations" USING btree ("entity_type","entity_id","metric","observed_at");--> statement-breakpoint
CREATE INDEX "source_observations_source_metric_time_idx" ON "source_observations" USING btree ("source_id","metric","observed_at");--> statement-breakpoint
CREATE INDEX "source_observations_status_time_idx" ON "source_observations" USING btree ("status","observed_at");--> statement-breakpoint
CREATE INDEX "source_registry_status_priority_idx" ON "source_registry" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "transfer_restrictions_target_time_idx" ON "transfer_restrictions" USING btree ("product_id","route_id","effective_from");--> statement-breakpoint
CREATE INDEX "alert_events_rule_time_idx" ON "alert_events" USING btree ("alert_rule_id","triggered_at");--> statement-breakpoint
CREATE INDEX "alert_rules_user_active_idx" ON "alert_rules" USING btree ("user_id","enabled","archived_at");--> statement-breakpoint
CREATE INDEX "alert_rules_target_condition_idx" ON "alert_rules" USING btree ("product_id","route_id","condition");--> statement-breakpoint
CREATE INDEX "linked_wallet_addresses_user_active_idx" ON "linked_wallet_addresses" USING btree ("user_id","enabled","deleted_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_retry_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_destinations_user_active_idx" ON "notification_destinations" USING btree ("user_id","disabled_at");--> statement-breakpoint
CREATE INDEX "route_simulations_user_time_idx" ON "route_simulations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "route_simulations_status_time_idx" ON "route_simulations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "saved_comparisons_user_active_idx" ON "saved_comparisons" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "saved_views_user_active_idx" ON "saved_views" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "watchlists_user_active_idx" ON "watchlists" USING btree ("user_id","archived_at");
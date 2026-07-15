import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { assets, chains, jurisdictions } from "./catalog.js";
import { investorClassificationEnum, roleCodeEnum, userStatusEnum } from "./enums.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProvider: varchar("auth_provider", { length: 64 }).notNull(),
    authSubjectId: text("auth_subject_id").notNull(),
    email: text("email"),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow(),
    disabledAt: utcTimestamp("disabled_at"),
    deletionRequestedAt: utcTimestamp("deletion_requested_at"),
    anonymizedAt: utcTimestamp("anonymized_at")
  },
  (table) => [
    unique("users_auth_subject_unique").on(table.authProvider, table.authSubjectId),
    index("users_status_idx").on(table.status),
    check("users_auth_provider_not_blank", sql`btrim(${table.authProvider}) <> ''`),
    check("users_auth_subject_not_blank", sql`btrim(${table.authSubjectId}) <> ''`),
    check(
      "users_disabled_timestamp",
      sql`${table.status} <> 'DISABLED' or ${table.disabledAt} is not null`
    ),
    check(
      "users_anonymized_timestamp",
      sql`${table.status} <> 'ANONYMIZED' or ${table.anonymizedAt} is not null`
    )
  ]
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    displayName: text("display_name"),
    jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    investorClassification: investorClassificationEnum("investor_classification")
      .notNull()
      .default("UNKNOWN"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    check(
      "user_profiles_display_name_not_blank",
      sql`${table.displayName} is null or btrim(${table.displayName}) <> ''`
    )
  ]
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    timezone: text("timezone").notNull().default("UTC"),
    riskProfile: varchar("risk_profile", { length: 32 }).notNull().default("BALANCED"),
    acceptsKycRoutes: boolean("accepts_kyc_routes"),
    acceptsIncentiveYield: boolean("accepts_incentive_yield"),
    defaultHoldingPeriodDays: integer("default_holding_period_days"),
    displayCurrencyAssetId: uuid("display_currency_asset_id").references(() => assets.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    presentation: jsonb("presentation")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    check("user_preferences_timezone_not_blank", sql`btrim(${table.timezone}) <> ''`),
    check(
      "user_preferences_holding_period_positive",
      sql`${table.defaultHoldingPeriodDays} is null or ${table.defaultHoldingPeriodDays} > 0`
    ),
    check(
      "user_preferences_presentation_object",
      sql`jsonb_typeof(${table.presentation}) = 'object'`
    )
  ]
);

export const userPreferredChains = pgTable(
  "user_preferred_chains",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chains.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.chainId],
      name: "user_preferred_chains_pk"
    })
  ]
);

export const userPreferredAssets = pgTable(
  "user_preferred_assets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.assetId],
      name: "user_preferred_assets_pk"
    })
  ]
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: roleCodeEnum("code").notNull(),
    description: text("description").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [unique("roles_code_unique").on(table.code)]
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    grantedAt: utcTimestamp("granted_at").notNull().defaultNow(),
    expiresAt: utcTimestamp("expires_at"),
    revokedAt: utcTimestamp("revoked_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId], name: "user_roles_pk" }),
    index("user_roles_active_lookup_idx").on(table.userId, table.revokedAt, table.expiresAt),
    check(
      "user_roles_expiry_after_grant",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.grantedAt}`
    ),
    check(
      "user_roles_revoke_after_grant",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`
    )
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    providerSessionIdHash: varchar("provider_session_id_hash", { length: 128 }).notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    lastSeenAt: utcTimestamp("last_seen_at").notNull().defaultNow(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    recentAuthAt: utcTimestamp("recent_auth_at"),
    revokedAt: utcTimestamp("revoked_at"),
    revocationReason: varchar("revocation_reason", { length: 128 })
  },
  (table) => [
    unique("sessions_provider_hash_unique").on(table.providerSessionIdHash),
    index("sessions_user_active_idx").on(table.userId, table.revokedAt, table.expiresAt),
    check("sessions_expiry_after_create", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "sessions_revocation_reason_present",
      sql`${table.revokedAt} is null or (${table.revocationReason} is not null and btrim(${table.revocationReason}) <> '')`
    )
  ]
);

export const administrators = pgTable(
  "administrators",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    mfaEnforced: boolean("mfa_enforced").notNull().default(false),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    approvedAt: utcTimestamp("approved_at"),
    revokedAt: utcTimestamp("revoked_at"),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    check(
      "administrators_approval_pair",
      sql`(${table.approvedByUserId} is null) = (${table.approvedAt} is null)`
    )
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;

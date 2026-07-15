import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { jobStatusEnum, reviewOutcomeEnum } from "./enums.js";
import { sourceRegistry } from "./provenance.js";

const utcTimestamp = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: varchar("job_name", { length: 96 }).notNull(),
    jobVersion: varchar("job_version", { length: 64 }).notNull(),
    payloadVersion: varchar("payload_version", { length: 64 }).notNull(),
    sourceId: uuid("source_id").references(() => sourceRegistry.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    status: jobStatusEnum("status").notNull(),
    attempt: integer("attempt").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    producerIdentity: varchar("producer_identity", { length: 96 }).notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    correlationId: uuid("correlation_id").notNull(),
    queuedAt: utcTimestamp("queued_at").notNull(),
    startedAt: utcTimestamp("started_at"),
    completedAt: utcTimestamp("completed_at"),
    recordsRead: integer("records_read").notNull().default(0),
    recordsAccepted: integer("records_accepted").notNull().default(0),
    recordsRejected: integer("records_rejected").notNull().default(0),
    recordsChanged: integer("records_changed").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    deadLetterCount: integer("dead_letter_count").notNull().default(0),
    freshRecordCount: integer("fresh_record_count").notNull().default(0),
    staleRecordCount: integer("stale_record_count").notNull().default(0),
    errorCategory: varchar("error_category", { length: 96 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow(),
    updatedAt: utcTimestamp("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("job_runs_idempotency_attempt_unique").on(table.idempotencyKey, table.attempt),
    index("job_runs_status_queue_idx").on(table.status, table.queuedAt),
    index("job_runs_source_time_idx").on(table.sourceId, table.queuedAt),
    index("job_runs_correlation_idx").on(table.correlationId),
    check("job_runs_name_not_blank", sql`btrim(${table.jobName}) <> ''`),
    check(
      "job_runs_attempt_range",
      sql`${table.attempt} > 0 and ${table.attempt} <= ${table.maxAttempts}`
    ),
    check(
      "job_runs_counts_nonnegative",
      sql`${table.recordsRead} >= 0 and ${table.recordsAccepted} >= 0 and ${table.recordsRejected} >= 0 and ${table.recordsChanged} >= 0 and ${table.retryCount} >= 0 and ${table.deadLetterCount} >= 0 and ${table.freshRecordCount} >= 0 and ${table.staleRecordCount} >= 0`
    ),
    check(
      "job_runs_start_state",
      sql`${table.status} in ('QUEUED', 'CANCELLED') or ${table.startedAt} is not null`
    ),
    check(
      "job_runs_completion_state",
      sql`${table.status} in ('QUEUED', 'RUNNING') or ${table.completedAt} is not null`
    ),
    check(
      "job_runs_time_order",
      sql`(${table.startedAt} is null or ${table.startedAt} >= ${table.queuedAt}) and (${table.completedAt} is null or (${table.startedAt} is not null and ${table.completedAt} >= ${table.startedAt}))`
    )
  ]
);

export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: varchar("topic", { length: 96 }).notNull(),
    payloadVersion: varchar("payload_version", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    availableAt: utcTimestamp("available_at").notNull(),
    publishedAt: utcTimestamp("published_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCategory: varchar("last_error_category", { length: 96 }),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("job_outbox_idempotency_unique").on(table.idempotencyKey),
    index("job_outbox_pending_idx").on(table.publishedAt, table.availableAt),
    check("job_outbox_topic_not_blank", sql`btrim(${table.topic}) <> ''`),
    check("job_outbox_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check("job_outbox_attempts_nonnegative", sql`${table.attemptCount} >= 0`)
  ]
);

export const deadLetterJobs = pgTable(
  "dead_letter_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobRunId: uuid("job_run_id")
      .notNull()
      .references(() => jobRuns.id, { onDelete: "restrict", onUpdate: "cascade" }),
    payloadVersion: varchar("payload_version", { length: 64 }).notNull(),
    redactedPayload: jsonb("redacted_payload").notNull(),
    errorCategory: varchar("error_category", { length: 96 }).notNull(),
    replayOutcome: reviewOutcomeEnum("replay_outcome").notNull().default("PENDING"),
    replayedByUserId: uuid("replayed_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    replayedAt: utcTimestamp("replayed_at"),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("dead_letter_jobs_job_run_unique").on(table.jobRunId),
    index("dead_letter_jobs_expiry_idx").on(table.expiresAt),
    check(
      "dead_letter_jobs_payload_object",
      sql`jsonb_typeof(${table.redactedPayload}) = 'object'`
    ),
    check(
      "dead_letter_jobs_replay_pair",
      sql`(${table.replayedByUserId} is null) = (${table.replayedAt} is null)`
    ),
    check("dead_letter_jobs_expiry_after_create", sql`${table.expiresAt} > ${table.createdAt}`)
  ]
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    action: varchar("action", { length: 96 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: uuid("target_id").notNull(),
    targetRecordVersion: integer("target_record_version").notNull(),
    beforeValue: jsonb("before_value"),
    afterValue: jsonb("after_value"),
    reason: text("reason").notNull(),
    sourceId: uuid("source_id").references(() => sourceRegistry.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    verificationDate: utcTimestamp("verification_date"),
    outcome: reviewOutcomeEnum("outcome").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    occurredAt: utcTimestamp("occurred_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    index("admin_audit_logs_actor_time_idx").on(table.actorUserId, table.occurredAt),
    index("admin_audit_logs_target_time_idx").on(
      table.targetType,
      table.targetId,
      table.occurredAt
    ),
    index("admin_audit_logs_correlation_idx").on(table.correlationId),
    check("admin_audit_logs_action_not_blank", sql`btrim(${table.action}) <> ''`),
    check("admin_audit_logs_target_type_not_blank", sql`btrim(${table.targetType}) <> ''`),
    check("admin_audit_logs_record_version_positive", sql`${table.targetRecordVersion} > 0`),
    check(
      "admin_audit_logs_change_present",
      sql`num_nonnulls(${table.beforeValue}, ${table.afterValue}) > 0`
    ),
    check("admin_audit_logs_reason_not_blank", sql`btrim(${table.reason}) <> ''`)
  ]
);

export const securityAuditEvents = pgTable(
  "security_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    eventType: varchar("event_type", { length: 96 }).notNull(),
    outcome: reviewOutcomeEnum("outcome").notNull(),
    subjectHash: varchar("subject_hash", { length: 128 }),
    networkAddressHash: varchar("network_address_hash", { length: 128 }),
    details: jsonb("details")
      .notNull()
      .default(sql`'{}'::jsonb`),
    correlationId: uuid("correlation_id").notNull(),
    occurredAt: utcTimestamp("occurred_at").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    index("security_audit_events_type_time_idx").on(table.eventType, table.occurredAt),
    index("security_audit_events_actor_time_idx").on(table.actorUserId, table.occurredAt),
    check("security_audit_events_type_not_blank", sql`btrim(${table.eventType}) <> ''`),
    check("security_audit_events_details_object", sql`jsonb_typeof(${table.details}) = 'object'`),
    check("security_audit_events_expiry_after_event", sql`${table.expiresAt} > ${table.occurredAt}`)
  ]
);

export const dataDeletionReceipts = pgTable(
  "data_deletion_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    outcome: reviewOutcomeEnum("outcome").notNull(),
    completedAt: utcTimestamp("completed_at").notNull(),
    backupExpiryAt: utcTimestamp("backup_expiry_at").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: utcTimestamp("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("data_deletion_receipts_request_hash_unique").on(table.requestHash),
    check(
      "data_deletion_receipts_backup_expiry",
      sql`${table.backupExpiryAt} >= ${table.completedAt}`
    )
  ]
);

export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

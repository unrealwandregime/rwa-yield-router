# RWA Yield Router Operations Runbook

## Purpose

This runbook is the production response guide for the web application, worker, PostgreSQL, Redis/queues, external data adapters, authentication, and notifications. Protect user data and analytical integrity before availability. Never make stale or unknown data look current, replace a missing value with zero, delete provenance, or silently rewrite history to recover service.

All incident times, observations, and decisions are recorded in UTC. Use an incident channel and restricted incident record for SEV-1/2 events. Commands that mutate production must run through an audited operator job; do not paste ad-hoc SQL into a shared shell.

## Roles and severity

| Role                | Responsibility                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| Incident commander  | Owns severity, priorities, decisions, handoffs, and closure               |
| Operations lead     | Web, worker, queue, database, deployment, and rollback actions            |
| Data lead           | Source validity, observations, APY/risk recalculation, and product status |
| Security lead       | Identity, secrets, evidence preservation, containment, and disclosure     |
| Communications lead | Operator, user, provider, and status updates                              |
| Scribe              | UTC timeline, correlation IDs, actions, evidence, and follow-up owners    |

| Severity | Example                                                                                        | Response target                               |
| -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| SEV-1    | Compromise, cross-user/admin access, widespread false analytics, unrecoverable critical outage | Page immediately; commander within 15 minutes |
| SEV-2    | Major outage, large stale-data set, incorrect published APY, alert spam/failure                | Commander within 30 minutes                   |
| SEV-3    | Isolated adapter, queue, product, or notification degradation                                  | Triage within 4 business hours                |
| SEV-4    | Low-impact defect or hardening work                                                            | Triage within 2 business days                 |

Targets are operational goals, not legal-notification deadlines. The security lead and counsel determine notification obligations.

## Operator safety rules

- Confirm environment, service, release, region, and UTC time before any mutation.
- Preserve logs, job IDs, source observations, methodology version, and database recovery point before cleanup.
- Prefer pausing, quarantining, or appending a correction over deletion.
- Use least-privilege named accounts with MFA; no shared or default credentials.
- Do not bulk replay dead letters, retry migrations, raise concurrency, rotate secrets, or restore a database without an explicit hypothesis and rollback plan.
- Keep the public application read-only or degraded when safe; mark affected data `Stale`, `Unavailable`, `Estimated`, or `Awaiting verification`.
- Never publish an unverified fallback or treat a provider response as trusted merely because it is “official.”
- Two operators review role grants, methodology publication, broad data corrections, and destructive actions.

## Service map and first checks

| Signal            | Source               | Healthy meaning                                                    |
| ----------------- | -------------------- | ------------------------------------------------------------------ |
| `/health/live`    | Web/process probe    | Process can answer; no dependency check                            |
| `/health/ready`   | Web/worker readiness | Schema and critical PostgreSQL/Redis dependencies are compatible   |
| Provider overview | Admin/metrics        | Adapter success, latency, circuit state, last good fetch           |
| Job dashboard     | Admin/queue metrics  | Scheduler heartbeat, queue depth/age, retry and dead-letter counts |
| Data freshness    | Metrics/admin        | Required observations meet their metric-specific cadence           |
| Alert delivery    | Metrics/admin        | Evaluation, suppression, send, webhook, and retry states progress  |
| Release dashboard | Deployment provider  | Web/worker commit, artifact, migration, and rollout match          |

Initial alert thresholds are versioned configuration and should be tuned after baseline collection:

- Page on readiness failure for 5 minutes, public 5xx above 2% for 5 minutes, or confirmed integrity/security failure.
- Warn at database/Redis resource use above 80%; page before exhaustion or sustained lock/latency impact.
- Warn when oldest runnable job exceeds twice its expected schedule; page when critical freshness will breach.
- Open a data event after three consecutive adapter failures or any critical observation beyond its freshness SLA.
- Alert on any unexpected dead-letter job, scheduler heartbeat gap, admin-role change, webhook signature spike, or production secret-scan finding.
- Warn on notification failure above 5% for 15 minutes; page on broad alert loss or spam.

## Zero-budget preview controls

- `render.yaml` is a preview-only topology of two Render Free web services. It is not a production release, availability target, or substitute for the persistent worker and restorable datastores required by the Definition of Done.
- Automatic deploys are disabled. Run the migration, reference seed, catalog import, and verification gate from an audited release workspace; then deploy the worker preview before web from the identical commit.
- Catalog imports may update evidence/status for the reviewed identity set, but an external-ID addition/removal or stable-slug replacement is intentionally blocked until a versioned retirement/replacement workflow has been implemented and rehearsed. Never bypass this guard with direct SQL.
- The worker preview sleeps after idle periods. The hourly GitHub wake request is best-effort and does not guarantee schedule cadence. Treat stale scheduler heartbeat, late queue jobs, or missed alert windows as an expected preview limitation that must remain visible, not as evidence that data is current.
- Monitor the shared Render running-hour allowance plus Supabase, Upstash, Resend, and GitHub Actions quotas. Stop ingestion or alerts before a hard limit can create partial processing; never silently drop or fabricate work.
- Render variables marked `sync: false` are managed in each service after initial creation. Compare shared values across both services without printing them, and rotate `DATA_ENCRYPTION_KEY` only with an explicit encrypted-data migration and rollback plan.
- The Blueprint sets `OBSERVABILITY_MODE=platform`. Review Render's host-collected stdout/stderr for bounded `observability.error_captured` records; the worker reporter redacts them before emission. Free log retention and the absence of an independent alerting destination remain expected preview gaps.
- Supabase Free has no managed backups or PITR. Make reviewed off-site logical dumps for preview recovery, but do not claim that manual preview dumps satisfy the production backup and restore gate.

## Standard incident sequence

1. **Acknowledge and classify.** Assign commander/scribe, state user and data impact, record the first alert and release/provider changes.
2. **Contain.** Pause only affected schedules, adapters, products, alerts, or traffic. Preserve a safe cached/read-only path when possible.
3. **Diagnose.** Correlate by request/job/source/run ID. Compare last-known-good release, observation, and provider status.
4. **Recover.** Use an idempotent retry, verified alternate source, compatible application rollback, or tested forward fix. Recalculate derived values after source correction.
5. **Verify.** Check health, logs, metrics, UI labels, API provenance, job idempotency, authorization, and representative user flows.
6. **Communicate and close.** Record scope, affected interval, correction, evidence, remaining risk, follow-up owner/date, and user/provider notice where required.

## Runbook: external provider outage

**Trigger:** consecutive adapter failures, timeout/error spike, open circuit, missing scheduler results, or provider notice.

1. Identify provider, adapter version, affected metrics/routes, last successful observation, freshness deadlines, and whether failure is auth, quota, DNS, schema, or upstream availability.
2. Keep the circuit breaker open and cap retries; do not multiply traffic or disable outbound-request protections.
3. Serve last-known-good observations with their original `observedAt` and explicit status. Never advance timestamps on a failed fetch.
4. Activate only a pre-approved fallback in documented source-priority order. Store the new source/confidence; do not splice fields without provenance.
5. If no valid fallback exists, mark affected values stale/unavailable and exclude stale-critical routes from normal optimization and alerts.
6. Recover with a bounded health check, then a canary fetch and gradual concurrency restoration. Verify normalization, duplicates, freshness, source link, and downstream recalculation.
7. Close after two expected successful cycles and backlog clearance; document provider communication and whether limits/fallback policy need change.

For `OND-USDY`, isolate transport failures by chain. An Ethereum oracle failure affects yield and
all route-AUM calculations; a Mantle, Solana, or Arbitrum RPC failure affects only that route's AUM.
Do not substitute Ondo's marketing-page APY/TVL, add chain supplies together as a route value, or
reuse another chain's block height. Recovery requires a non-zero oracle price, a non-zero historical
price, a canonical token-supply response, and two successful scheduled cycles.

## Runbook: database migration failure

**Trigger:** migration job exits non-zero, lock timeout, partial DDL, readiness schema mismatch, or post-migration query failure.

1. Stop the release, keep old compatible web/worker versions, and pause any worker that requires the new schema.
2. Capture migration ID, exact error, database activity/locks, release SHA, start/end times, and pre-deploy recovery point. Do not repeatedly rerun.
3. Determine whether the migration is transactional and whether committed changes exist. Compare the migration ledger and actual schema.
4. Cancel only confirmed blocking work with database-owner approval. Never terminate unknown sessions reflexively.
5. Choose a tested forward fix. Use a down migration only when non-destructive, rehearsed, and no new-version data depends on it; otherwise restore only as an approved SEV-1 recovery.
6. Validate the repair on a production-like copy, rerun migration validation, then execute once under the deployment advisory lock.
7. Verify constraints, indexes/query plans, row counts, audit/methodology history, readiness, worker jobs, and smoke tests before resuming rollout.

## Runbook: worker backlog or stuck jobs

**Trigger:** oldest-job age over threshold, growing queue, lost heartbeat, repeated retries, dead letters, or freshness at risk.

1. Break backlog down by queue, provider, job type, status, retry count, age, and worker release. Check Redis latency/memory and PostgreSQL locks.
2. Pause the failing producer or job type if it is amplifying the queue. Preserve unrelated ingestion and stale detection.
3. Inspect one representative job and its correlation/source-run ID. Validate payload schema, idempotency key, lock lease, provider limit, and recent deploy.
4. Do not raise concurrency until database, Redis, and provider headroom are confirmed. Increase gradually with rate-limit isolation.
5. Quarantine poison jobs in the dead-letter queue. Replay only selected jobs after schema revalidation and an audited reason.
6. Recover oldest critical freshness work first, then normal order. Confirm duplicate prevention and that old observations cannot overwrite newer ones.
7. Close when age and depth return to baseline, freshness recovers, no locks are orphaned, and two schedule cycles succeed.

For ingestion incidents, reconcile the terminal `job_runs` row with the same-correlation
`adapter_health` row. A final failure must also have one redacted `dead_letter_jobs` row; the Redis
dead-letter queue alone is not durable release evidence. For daily history, verify that rollups cover
only completed UTC days and still reference the selected immutable yield snapshot.
When a prior interrupted release left an observation without its typed snapshot, replay the exact
idempotent ingestion job: the reconciliation path must insert only the missing typed row. For alert
incidents, verify every deduplicated event has the expected destination-delivery rows before replay;
re-evaluation reconciles missing rows without duplicating existing deliveries.

## Runbook: stale data

**Trigger:** freshness event, stale-record count spike, missing observations, or UI/API showing current status past SLA.

1. Scope by metric, source, category, chain, route, adapter, and first stale time. Confirm configured SLA rather than assuming one global cadence.
2. Verify scheduler heartbeat, queue age, adapter health, source publication cadence, clock skew, and normalization/reconciliation failures.
3. Immediately ensure API and UI retain the original observation time and show `Stale`. Exclude stale-critical routes from standard optimization.
4. Repair the scheduler/adapter or use an approved fallback. Do not manually edit timestamps or synthesize a value.
5. Re-run bounded idempotent ingestion, then dependent liquidity, risk, penalty, historical-rollup, and alert evaluation jobs in order.
6. Verify freshness, provenance, confidence, route status, charts, downloadable reports, and no stale alert was incorrectly suppressed or emitted.

## Runbook: incorrect APY or derived financial value

**Trigger:** source disagreement, user/admin report, implausibility check, decimal/fee error, or verified upstream correction.

1. Treat broad or materially misleading publication as SEV-2 or higher. Record product/route, gross/net APY components, horizon, observation, source, methodology, and affected interval.
2. Pause the route from ranking, optimization, and APY threshold alerts; label the value `Awaiting verification`. Do not delete the original snapshot.
3. Trace raw observation → normalization → APY components → fees/cost annualization → risk penalties. Check units, percent/basis-point conversion, compounding, incentives, expiry, and price-return misclassification.
4. Confirm against the official source and an independent permitted source/on-chain derivation where possible. Contact the provider for ambiguous data.
5. Fix code/config or append a sourced corrective observation. Recalculate affected snapshots and simulations with explicit calculation times and versions.
6. Identify users, reports, comparisons, and alerts affected. Notify them when the error was material; do not imply corrected historical results were originally shown.
7. Reinstate only after two-person data review, tests for the failure mode, API/UI reconciliation, and audit-log verification.

## Runbook: compromised API or service credential

**Trigger:** provider warning, secret scan, unauthorized use, leaked log/artifact, anomalous quota, or credible report.

1. Declare a security incident. Preserve evidence without copying the credential into the incident record.
2. Disable the affected adapter/service if necessary, revoke the credential at the provider, and rotate to a new scoped value from a clean operator session.
3. Update the secret manager and restart only consumers that need it. Never place the replacement in source, shell history, screenshots, or chat.
4. Search Git history, build artifacts, CI/deploy logs, telemetry, tickets, dead letters, and backups for exposure. Review provider access logs and actions from creation to revocation.
5. Rotate adjacent credentials when scope or exposure is uncertain. Revoke sessions/tokens derived from the secret and invalidate untrusted observations or deliveries.
6. Test a bounded request, monitor usage, and document cause, exposure window, data impact, notifications, and rotation-register update.

## Runbook: alert-delivery failure or spam

**Trigger:** send failure spike, webhook rejection, stuck delivery states, duplicate messages, complaint, or missing test notification.

1. Scope channel, provider, alert type, user count, release, evaluation versus delivery failure, and first/last affected event.
2. For spam/duplicates, pause affected delivery workers or rule class immediately while preserving event records. For outage, keep deduplicated due events queued within expiry policy.
3. Check provider status/quota, credentials, verified sender/bot, webhook signature and clock, template rendering, unsubscribe state, cooldown, event idempotency, and retry policy.
4. Fix and send one operator canary. Replay only still-relevant events once; expired market alerts are marked failed/expired, not delivered late without context.
5. Verify delivery logs, webhook transitions, deduplication, cooldown, timezone, disable/unsubscribe controls, and no secret or sensitive payload in provider logs.
6. Notify affected users when material alerts were lost or duplicated and record counts by status.

## Runbook: application rollback

**Trigger:** failed smoke test, elevated errors/latency, auth regression, incompatible queue/schema behavior, or unsafe data output after deployment.

1. Assign rollback owner and record current/prior web, worker, schema, queue payload, and methodology versions.
2. Pause schedules, publication, or alerts when integrity is affected. Preserve request/job/source IDs.
3. Route web traffic to the last known-good artifact if it is schema-compatible.
4. Roll worker back only if compatible with current schema and queued payload versions; otherwise leave the affected consumer paused and forward-fix.
5. Do not reverse a database migration unless its tested down path is non-destructive and no new data depends on it.
6. Quarantine observations produced by the bad release, append corrections, and recalculate downstream outputs. Preserve history.
7. Run readiness, authorization, core journeys, data provenance, APY/risk reconciliation, queues, and notifications before restoring schedules and full traffic.

## Runbook: pause or close a product/route

**Trigger:** issuer/protocol pause, exploit, redemption suspension, eligibility change, unreliable data, closure, or admin decision with sources.

1. Verify source, effective time, scope, and whether status is `PAUSED`, `RESTRICTED`, `CLOSED`, `UNAVAILABLE`, or `AWAITING_VERIFICATION`.
2. Use the audited admin workflow with actor, before/after status, reason, source, verification date, and review/expiry date. Two-person review is required for broad emergency actions where available.
3. Exclude the record immediately from standard optimization and new positive opportunity alerts. Preserve product pages and history with a prominent status and timestamp.
4. Evaluate affected watchlists, saved simulations, wallet holdings, comparisons, and status/redemption/eligibility alerts. Inform users factually without giving transaction instructions.
5. Stop unnecessary ingestion but retain jobs needed to detect recovery or closure terms. Never fabricate an exit route or liquidity.
6. Reinstate only with current official evidence, refreshed critical metrics, full dependent recalculation, and reviewer approval.

## Runbook: curated data and methodology review

1. Open the administration console with an MFA-verified, recently authenticated account. Select the exact evidence source before using any quick metadata action.
2. Create or edit sources as drafts. Review the canonical URL, ownership, terms/licence, cadence, freshness threshold, attribution, and removal procedure before publication. An edit creates a new version and leaves the previous version auditable.
3. Create catalog, entity, eligibility, redemption, and source-link drafts with a reason and evidence verification time. Never change an imported observation to make it agree with a manual assessment; append an annotation or non-destructive override and resolve the resulting quality event only after reconciliation.
4. Use route lifecycle state for `PAUSED`, `RESTRICTED`, `CLOSED`, or `UNAVAILABLE`; use publication state for review/reject/archive decisions. Queue re-ingestion only for a route with a canonical admitted adapter identity.
5. Before publishing a risk methodology, verify every one of the six categories includes every canonical factor and totals exactly 100 percent. The reviewer and publisher must be different accounts. Published methodology versions are immutable.
6. Export the formula-safe data-quality CSV for review evidence. Record the snapshot time and correlation IDs for all material actions. Security-audit events require `SECURITY_ADMIN` and are intentionally separated from ordinary administration.

## Runbook: security incident

**Trigger:** unauthorized access, privilege escalation, data exfiltration, analytics tampering, forged webhook/job, malware, or credible vulnerability exploitation.

1. Follow `SECURITY.md`: declare severity, assign security lead, restrict the incident record, preserve logs/snapshots, and record UTC timeline.
2. Contain with the smallest safe boundary: revoke sessions/roles/secrets, disable affected endpoint/adapter, quarantine jobs, pause publication/alerts, or place the service in read-only mode.
3. Preserve evidence before rebuilding. Do not let suspected hosts or credentials perform containment.
4. Determine affected identities, data, routes, releases, credentials, providers, and time range. Treat manipulated analytical data as material integrity impact.
5. Patch, rebuild from trusted immutable artifacts, rotate affected trust, invalidate forged records, and recalculate from verified sources.
6. Recover gradually with authorization, object-ownership, webhook, queue, redaction, provenance, and core-journey tests plus heightened monitoring.
7. Coordinate user/provider/regulatory communication with counsel. Complete a root-cause review within five business days of recovery and track actions to closure.

## Runbook: user-data deletion request

**Trigger:** verified account holder requests deletion through the supported privacy channel.

1. Create a restricted request record and verify identity through the auth provider without collecting unnecessary identity documents. Do not disclose whether an unrelated account exists.
2. Place the account in deletion-pending state; revoke sessions, disable alerts, stop deliveries, and block new account-linked processing.
3. Inventory account profile, preferences, watchlists, comparisons, simulations, alert rules/events, notification destinations, linked public wallet addresses, and user-owned exports.
4. Delete or irreversibly anonymize active records within the documented 30-day target. Remove identity-provider data through its supported API. Preserve only legally required security/admin facts with identity minimized and access restricted.
5. Confirm processors and notification providers receive deletion requests where required. Do not delete public market observations merely because the user viewed them.
6. Record a minimal non-identifying fulfillment receipt. Tell the requester the completion date and that encrypted backups expire on the normal rolling schedule, currently up to 35 days.
7. Verify the user cannot sign in or receive notifications and that anonymized foreign-key, aggregate, and audit integrity remains valid.

## Backup restore and disaster recovery

1. Declare SEV-1/2, freeze writes, record the recovery objective and selected point-in-time, and preserve the failed system for analysis.
2. Restore into an isolated environment first. Validate migrations, constraints, row counts, latest published methodology, provenance, audit records, user ownership, and product publication state.
3. Deploy compatible web/worker artifacts and run full security, data, queue, and user-journey smoke tests.
4. Obtain incident commander, database owner, data lead, and security approval before traffic cutover.
5. Rotate credentials if compromise caused the restore. Reconcile idempotent jobs from database job records; Redis/cache is not authoritative.
6. Record achieved recovery point/time and any known data gap. Conduct a restore exercise at least quarterly.

## Routine operations

### Daily

- Review availability, provider circuits, failed/dead-letter jobs, freshness breaches, alert delivery, auth/security anomalies, backup status, and product pauses.
- Confirm exactly one scheduler leader and that critical schedules completed.

### Weekly

- Review legal/eligibility records due for verification, source links, adapter health trends, manual overrides nearing expiry, queue capacity, and unresolved data-quality events.

### Monthly and quarterly

- Review access and admin roles monthly; remove stale access immediately.
- Review secret rotation register, dependency findings, rate/query limits, retention jobs, and service objectives monthly.
- Test database restore, incident contact tree, credential rotation, and one provider-failover scenario quarterly.

## Incident closure checklist

- User and data impact, start/end time, and severity are established.
- Health, freshness, queues, alerts, security controls, and representative UI/API paths are verified.
- Incorrect records are quarantined/corrected with provenance; history remains auditable.
- Affected users/providers were notified when required.
- Monitoring and tests cover the observed failure mode.
- Root cause, contributing factors, detection gap, actions, owners, and deadlines are recorded.
- Temporary flags, elevated access, paused schedules, and emergency credentials are removed or have explicit owners and expiry.

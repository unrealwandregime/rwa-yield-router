# RWA Yield Router Deployment Guide

## Release standard

RWA Yield Router is released as one production product: web application, worker, database schema, verified production dataset, schedules, alerts, observability, and operator access must be compatible and verified before public launch. A landing page or web-only deployment is not a production release.

This guide is provider-portable. Use deployment providers available in the authenticated owner environment, but preserve the topology and controls below. Never publish default credentials, test fixtures, mock observations, or unreviewed product records.

## Reference topology

| Component | Production requirement | Exposure |
| --- | --- | --- |
| Next.js web/API | Node-compatible production host, immutable build, autoscaling, HTTPS | Public through CDN/WAF |
| Worker/scheduler | Persistent Node.js process or managed worker with controlled concurrency | Private; health endpoint or platform process check only |
| PostgreSQL | Managed PostgreSQL with TLS, point-in-time recovery, daily backups, direct migration connection and pooled runtime connection | Private/network restricted |
| Redis/queue | Managed Redis with TLS, persistence appropriate to queue semantics, eviction disabled for queue keys | Private/network restricted |
| Authentication | Mature hosted identity provider with verified production callback URLs and MFA for admins | Public provider endpoints |
| Email | Transactional provider adapter; console transport only outside production | Worker outbound plus signed webhook inbound |
| Telegram | Bot API adapter, disabled until owner supplies credentials | Worker outbound plus verified webhook inbound if used |
| External data | Official/approved APIs, RPCs, subgraphs, oracles, and manually reviewed records | Worker outbound through adapter allowlists |
| Observability | Structured log sink, metrics, uptime checks, error tracking, release identifiers | Restricted operator access |

The public web service reads normalized, published data. Scheduled ingestion belongs in the worker, not request handlers. External provider failure must degrade data status without making cached public pages unavailable. Only the web/API is internet-addressable; database, Redis, worker control endpoints, and migration jobs are private.

## Environments

Use isolated credentials, databases, Redis namespaces/instances, auth tenants, notification providers, and monitoring projects for:

| Environment | Purpose | Data policy |
| --- | --- | --- |
| Local | Development and automated tests | Test fixtures only; no production credentials |
| Preview | Per-change UI/API validation | Ephemeral test database or read-only sanitized snapshot; notifications sinked |
| Staging | Migration, ingestion, E2E, security, and release-candidate verification | Sourced staging records; never deliver alerts to real users |
| Production | Public service | Verified and published records only |

Preview builds must not connect to production PostgreSQL or Redis. Staging and production auth callbacks, cookie domains, API credentials, and webhook secrets must be distinct.

## Build and runtime requirements

- Use the repository-pinned Node.js and pnpm versions and install with the committed lockfile.
- CI builds with `pnpm install --frozen-lockfile`; production does not resolve dependencies at startup.
- Build once per release and promote the same immutable artifact or commit SHA through environments.
- Run containers as a non-root user with a read-only filesystem where platform support allows it. Do not bake `.env` files or secrets into images.
- Web and worker expose the same `APP_VERSION` and `METHODOLOGY_VERSION` release metadata.
- Run in UTC. Convert time zones only at the presentation or notification boundary.
- Use separate least-privilege database roles for runtime and migrations.
- Configure graceful shutdown: stop accepting work, finish or release the current job lock, close queue/database connections, and exit inside the platform termination window.

## Configuration and secrets

`.env.example` is the canonical variable list and must contain descriptions but no values that grant access. Exact names may be extended by adapters; the following classes are required.

### Non-secret configuration

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `local`, `preview`, `staging`, or `production` |
| `APP_VERSION` | Immutable commit or release identifier |
| `NEXT_PUBLIC_APP_URL` | Intentional public canonical HTTPS origin |
| `LOG_LEVEL` | Structured log threshold |
| `WORKER_CONCURRENCY` | Bounded global concurrency |
| `SCHEDULES_ENABLED` | Explicit scheduler enable flag; true in only one production scheduler instance |
| `EMAIL_TRANSPORT` | `provider`, or `console` outside production only |
| `TELEGRAM_ENABLED` | False until credentials and test delivery are verified |
| `ERROR_TRACKING_ENVIRONMENT` | Environment label |
| `SECURITY_CONTACT_EMAIL` | Monitored address published in security metadata |

Any `NEXT_PUBLIC_` value is shipped to browsers and must be intentionally public. Provider secrets, database URLs, internal tokens, and notification credentials must never use that prefix.

### Server-only secrets

- `DATABASE_URL` — pooled least-privilege runtime connection
- `DIRECT_DATABASE_URL` — direct migration connection, available only to migration jobs
- `REDIS_URL`
- `AUTH_SECRET`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` as required by the selected provider
- `INTERNAL_JOB_TOKEN`, `CRON_SHARED_SECRET`
- Provider-specific API/RPC/explorer keys
- `EMAIL_API_KEY`, `EMAIL_WEBHOOK_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` when enabled
- `ERROR_TRACKING_AUTH_TOKEN`
- `DATA_ENCRYPTION_KEY` if application-level encryption is enabled

Store secrets in the platform’s encrypted secret manager, scope them by service and environment, and record owner and rotation dates. The web service does not receive worker-only provider keys unless it directly needs them. See `SECURITY.md` for inventory and rotation requirements.

## Production preflight

Before any production mutation:

1. Confirm the release commit is reviewed and the worktree and lockfile are clean.
2. Run `pnpm install --frozen-lockfile` and `pnpm validate` in CI.
3. Run formatting, lint, type checking, unit, integration, E2E, accessibility, production build, migration validation, secret scan, and dependency/security checks without skipped tests.
4. Confirm all six category-weight totals and risk-penalty tests pass.
5. Review pending migrations, query plans for new hot paths, lock duration, and rollback/forward-fix strategy.
6. Confirm a restorable production backup and point-in-time recovery position exist.
7. Validate production domains, auth callbacks, CORS, CSP allowlists, webhook URLs, and outbound adapter allowlists.
8. Confirm production contains no mock/test seed path and only reviewed source records can publish.
9. Confirm an operator, incident lead, and rollback owner are available for the deployment window.

## Deployment procedure

### 1. Provision PostgreSQL

- Create managed PostgreSQL in the target region with TLS required, encryption at rest, point-in-time recovery, automated backups, and restricted network access.
- Create separate migration and application roles. The application role must not own the schema or create extensions.
- Configure a pooled URL for runtime and a direct URL for migrations. Test a restore in staging before launch.

### 2. Provision Redis

- Create managed Redis with TLS and authentication. Restrict access to web and worker networks.
- Separate cache and durable queue keyspaces or instances where the provider’s eviction/persistence settings cannot safely satisfy both.
- Disable eviction for queue keys, configure queue retention and dead-letter limits, and alert on memory, connections, latency, and backlog.

### 3. Configure authentication

- Create the production auth tenant/application and exact HTTPS callback/logout URLs.
- Enable supported passwordless controls and administrator MFA. Disable unused identity providers.
- Configure secure cookie domain and session lifetime. Verify that preview origins are not production callbacks.

### 4. Configure secrets and non-secret settings

- Add environment-scoped values through the provider secret manager; do not paste them into source, build arguments, tickets, or logs.
- Give web, worker, migration, and CI only the values each needs.
- Keep notifications disabled until their verification steps pass.

### 5. Apply migrations

Run migrations as a one-off release job from the immutable artifact:

```text
pnpm db:migrate
```

The job uses `DIRECT_DATABASE_URL`, takes a PostgreSQL advisory deployment lock, records the release identifier, and exits before web traffic shifts. Migrations must be forward-compatible with the currently running web and worker. Use expand/migrate/contract changes across releases for destructive or long-running schema changes. Never run an unbounded backfill in the migration transaction.

On failure, stop the release and follow the database-migration runbook. Do not repeatedly rerun a partially understood migration.

### 6. Deploy the worker

- Deploy the worker artifact with schedules disabled initially.
- Verify process liveness, database/Redis connectivity, migration version, queue registration, adapter configuration, and clean structured logs.
- Run one bounded health-check and one idempotent ingestion job per enabled adapter. Confirm provenance, status, freshness, and deduplication.

### 7. Deploy the web application

- Deploy the same release version with production canonical origin and secure headers.
- Keep the prior version available for rapid traffic rollback.
- Verify `/health/live` before routing traffic and `/health/ready` before full promotion.

### 8. Create the first administrator securely

1. The intended administrator signs in through the production auth provider and enables MFA.
2. A database/security operator verifies the immutable provider user ID out of band.
3. Run the repository’s one-off admin grant command from an audited release job, supplying user ID and reason; do not set a default password or persistent bootstrap-admin environment variable.
4. A second operator reviews the role grant and audit event.
5. Verify the admin can access permitted pages and that a normal test user receives `403` from every admin endpoint.

### 9. Import verified production records

- Run the production seed/import command only against reviewed import files:

```text
pnpm db:seed
```

- The command must validate schema, duplicates, source URLs, verification and effective dates, category coverage, review status, and publication status.
- Test fixtures and mock observations are forbidden. A missing metric remains `Unavailable`, `Estimated`, `Stale`, or `Awaiting verification` as appropriate.
- Review counts and sample records in all six categories before publication.

### 10. Enable schedules and notifications

- Enable exactly one scheduler leader or the platform’s singleton scheduled jobs.
- Confirm idempotency locks and observe at least one successful cycle for prices, APY, liquidity/utilization, TVL, risk recalculation, and stale-data detection as applicable.
- Configure email with a real monitored sender, verified domain, unsubscribe behavior, and signed event webhook. Send a test to an operator account.
- Leave Telegram disabled unless the owner supplies credentials; then verify a test delivery, signature/secret, retry, and delivery log before enabling user delivery.

### 11. Run production smoke tests

Run automated smoke tests against the canonical production URL, followed by a human pass:

- `/health/live` returns success without dependency checks.
- `/health/ready` confirms schema compatibility and critical PostgreSQL/Redis readiness without exposing details.
- Dashboard, screener, all category pages, product/route pages, comparison, methodology, legal, robots, sitemap, and canonical metadata load.
- All six categories contain reviewed products/routes; source links, observation times, confidence, staleness, and unavailable states are visible.
- Net APY components and Comparative risk-adjusted APY penalties reconcile to API values; native gold price movement is not yield.
- Sign-in, account settings, watchlists, saved comparisons/simulations, alert creation/disable, and read-only wallet behavior work.
- Feasible and infeasible optimizer cases behave correctly and never construct or execute a transaction.
- Admin publication and audit logging work; normal and unauthenticated users cannot call admin or internal endpoints.
- Provider-degraded mode serves cached data and marks status without a crash.
- Secure headers, HTTPS cookies, CSRF, redirect allowlist, rate limits, redacted errors, and webhook rejection are verified.
- Desktop, mobile, keyboard, focus, partial, stale, empty, loading, and error states pass visual/accessibility review.

### 12. Promote and record the release

- Shift traffic gradually where the platform supports it and watch errors, API latency, database load, cache hit rate, job failures/backlog, stale-record count, and alert delivery.
- Record canonical public URL, commit/branch, artifact digest, migration IDs, web and worker versions, methodology version, product/route counts by category, operator names, smoke-test evidence, and start/end UTC times in the release record.
- A release is not complete until the canonical public URL is opened and tested externally.

## Health and observability contract

### `/health/live`

Indicates only that the process event loop can answer. It must not query providers, PostgreSQL, or Redis and must not expose version details beyond a safe release identifier.

### `/health/ready`

Checks bounded, critical dependencies: database connectivity, expected migration compatibility, Redis/queue connectivity where required by the service, and ability to serve the configured environment. It uses strict timeouts and returns a generic public result. Provider outages appear in the provider-health overview and metrics but do not make cached public web data unservable.

Monitor at minimum:

- Web availability, 5xx rate, p50/p95/p99 API latency, web vitals, and rate-limit volume
- Database connections, lock waits, slow queries, replication/backup health, and storage
- Redis memory, eviction, connections, latency, queue depth/oldest age, retries, and dead letters
- Adapter success/failure/circuit state, ingestion latency, freshness SLA, source disagreement, and stale-record count
- Scheduler heartbeat and job lock age
- Alert evaluation, delivery success, retry, suppression, and dead-letter rates
- Auth failures, admin denials/actions, CSP violations, webhook signature failures, and security events

All logs carry UTC timestamp, environment, service, release, event, severity, and correlation ID with security redaction.

## CI/CD

Pull requests run locked installation, format check, lint, type check, unit tests, integration tests against isolated PostgreSQL/Redis, E2E/accessibility tests, production build, migration validation, secret scan, dependency audit, and static security checks.

Main-branch release flow:

1. Repeat all pull-request checks.
2. Build immutable web/worker artifacts and record provenance.
3. Deploy to staging; apply migrations and run E2E/smoke tests.
4. Require protected-production environment approval.
5. Back up, apply the production migration job, deploy worker with schedules paused, deploy web, smoke test, enable schedules, and promote traffic.
6. Fail closed and retain the prior production artifact if a gate fails.

Scheduled workflows run dependency checks, source-health checks where terms permit, link validation, and stale manual-metadata reports. CI uses protected environment secrets and must not print values or provider response bodies containing credentials.

## Migration and data-change policy

- Prefer additive, backward-compatible migrations. Drop/rename/type-conversion operations require a later contract release after all runtimes stop using the old shape.
- Index creation on large tables uses a non-blocking supported strategy. Validate query plans before and after.
- Backfills are resumable, idempotent worker jobs with progress metrics and throttling.
- Every migration is tested from a production-like prior schema and from a clean database.
- Publication state, source provenance, methodology history, and admin audit records are never destructively reseeded.
- Database rollback is not the default response to application failure; traffic rollback or a tested forward fix is safer when the schema is already in use.

## Rollback

Rollback when smoke tests fail, error or latency budgets breach, authorization or integrity controls regress, jobs generate incorrect observations, or a new release cannot safely process existing queues.

1. Pause schedules and risky publication/alert paths if data integrity is involved.
2. Route traffic to the last known-good compatible web artifact.
3. Restore the last known-good worker only if it is compatible with the current schema and queued job versions; otherwise keep workers paused and forward-fix.
4. Do not reverse a migration unless its tested down path is non-destructive and no new-version data depends on it.
5. Quarantine bad observations by source/run ID; never delete the audit trail.
6. Run readiness, security, data-integrity, and user-journey smoke tests.
7. Record timeline, scope, evidence, and follow-up. See `OPERATIONS_RUNBOOK.md` for the full procedure.

## Backups and disaster recovery

- Enable point-in-time recovery and daily encrypted database backups with a rolling retention consistent with `SECURITY.md`.
- Store backup credentials outside application runtimes. Restrict restore privileges and log every restore/export.
- Test a restore to an isolated environment at least quarterly, including row counts, constraints, latest methodology, audit chain, and application smoke tests.
- Redis is not the source of truth for published analytics. Queue recovery uses idempotency keys and database job records; never assume cache recovery restores durable state.
- Define initial service objectives of 24-hour recovery-point objective and 4-hour recovery-time objective until production usage justifies tighter objectives. Review after launch and after every recovery exercise.

## Owner-input boundary

Deployment may proceed autonomously through safe local and staging work. Stop only at the exact step requiring unavailable owner authorization or credentials, and state precisely which provider login, database/Redis creation approval, email/Telegram credential, paid API key, custom-domain control, or production promotion approval is needed. Resume from that step immediately when provided; do not restart completed validation.

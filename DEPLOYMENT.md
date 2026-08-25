# RWA Yield Router Deployment Guide

## Release standard

RWA Yield Router is released as one production product: web application, worker, database schema, verified production dataset, schedules, alerts, observability, and operator access must be compatible and verified before public launch. A landing page or web-only deployment is not a production release.

This guide is provider-portable. Use deployment providers available in the authenticated owner environment, but preserve the topology and controls below. Never publish default credentials, test fixtures, mock observations, or unreviewed product records.

## Reference topology

| Component        | Production requirement                                                                                                        | Exposure                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Next.js web/API  | Node-compatible production host, immutable build, autoscaling, HTTPS                                                          | Public through CDN/WAF                                  |
| Worker/scheduler | Persistent Node.js process or managed worker with controlled concurrency                                                      | Private; health endpoint or platform process check only |
| PostgreSQL       | Managed PostgreSQL with TLS, point-in-time recovery, daily backups, direct migration connection and pooled runtime connection | Private/network restricted                              |
| Redis/queue      | Managed Redis with TLS, persistence appropriate to queue semantics, eviction disabled for queue keys                          | Private/network restricted                              |
| Authentication   | Mature hosted identity provider with verified production callback URLs and MFA for admins                                     | Public provider endpoints                               |
| Email            | Transactional provider adapter; console transport only outside production                                                     | Worker outbound plus signed webhook inbound             |
| Telegram         | Bot API adapter, disabled until owner supplies credentials                                                                    | Worker outbound plus verified webhook inbound if used   |
| External data    | Official/approved APIs, RPCs, subgraphs, oracles, and manually reviewed records                                               | Worker outbound through adapter allowlists              |
| Observability    | Structured log sink, metrics, uptime checks, error tracking, release identifiers                                              | Restricted operator access                              |

The public web service reads normalized, published data. Scheduled ingestion belongs in the worker, not request handlers. External provider failure must degrade data status without making cached public pages unavailable. Only the web/API is internet-addressable; database, Redis, worker control endpoints, and migration jobs are private.

## Environments

Use isolated credentials, databases, Redis namespaces/instances, auth tenants, notification providers, and monitoring projects for:

| Environment | Purpose                                                                 | Data policy                                                                   |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Local       | Development and automated tests                                         | Test fixtures only; no production credentials                                 |
| Preview     | Per-change UI/API validation                                            | Ephemeral test database or read-only sanitized snapshot; notifications sinked |
| Staging     | Migration, ingestion, E2E, security, and release-candidate verification | Sourced staging records; never deliver alerts to real users                   |
| Production  | Public service                                                          | Verified and published records only                                           |

Preview builds must not connect to production PostgreSQL or Redis. Staging and production auth callbacks, cookie domains, API credentials, and webhook secrets must be distinct.

## Build and runtime requirements

- Use the repository-pinned Node.js and pnpm versions and install with the committed lockfile.
- CI builds with `pnpm install --frozen-lockfile`; production does not resolve dependencies at startup.
- Build once per release and promote the same immutable artifact or commit SHA through environments.
- Run containers as a non-root user with a read-only filesystem where platform support allows it. Do not bake `.env` files or secrets into images.
- Run in UTC. Convert time zones only at the presentation or notification boundary.
- Use separate least-privilege database roles for runtime and migrations.
- Configure graceful shutdown: stop accepting work, finish or release the current job lock, close queue/database connections, and exit inside the platform termination window.

The production Docker build context is the repository root:

```sh
docker build -f apps/web/Dockerfile \
  --build-arg APP_URL=https://router.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-key \
  -t rwa-yield-router-web:release .
docker build -f apps/worker/Dockerfile -t rwa-yield-router-worker:release .
```

`APP_URL` and both public Supabase values are required web build arguments because Next.js embeds canonical metadata and browser authentication configuration during compilation. They are intentionally public values and are retained as the image's matching runtime defaults. Never pass service-role keys, database URLs, provider secrets, or notification credentials as build arguments. The release workflow reads these values from the `PRODUCTION_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` GitHub repository variables and fails the web build when they are missing or invalid. Runtime secrets are injected only when a container starts; do not override the three public values with a different environment at runtime.

The images use Node.js 24.17.0, run as the unprivileged `node` user, and contain dependency-aware health checks. The web image listens on `PORT` (3000 by default); the worker listens on `WORKER_PORT` (3001 by default). The GHCR workflow publishes immutable artifacts only. A separate, owner-authorized provider release must provision dependencies, run the one-off database commands below, deploy both images, promote traffic, and record smoke evidence.

## Zero-budget Render preview

The root [Render Blueprint](./render.yaml) is a zero-cost **preview topology**, not the production infrastructure described by this guide's Definition of Done. It creates two Render Free services from the CI-published immutable GHCR images:

- `rwa-yield-router-web` serves the public Next.js application.
- `rwa-yield-router-worker-preview` runs the existing worker container as a web service through its bounded health server on `WORKER_PORT=10000`. Its only public routes are generic liveness/readiness responses and token-protected internal metrics.

Render does not offer free background workers or free pre-deploy commands. Both services therefore run prebuilt images that were already built, scanned, and published by GitHub Actions, and the database release gate remains an explicit operator step. Render documents Free services as previews rather than production: they spin down after 15 idle minutes, can take about a minute to wake, share 750 monthly running hours per workspace, can restart at any time, cannot scale beyond one instance, and have no shell or one-off jobs. See [Render's Free instance limitations](https://render.com/docs/free).

The zero-cost dependency set is owner-provisioned and is not stored in the Blueprint:

| Dependency                    | Preview choice         | Mandatory safeguards and limits                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL and authentication | Supabase Free          | Use the shared Supavisor **session-mode** endpoint for persistent Render clients, a separate least-privilege runtime role, TLS with `sslmode=require` or stronger, and the direct endpoint for migrations when the release runner supports IPv6. Free projects have a 500 MB database limit, pause after inactivity, and do not include automatic backups or PITR.                         |
| Queue/cache                   | Upstash Redis Free     | Use the native Redis endpoint with `rediss://`; TLS is always enabled. Keep eviction disabled. The Free limit is 256 MB and 500,000 commands per month, has no production SLA/Prod Pack, and inactive databases can be archived. The preview sets `WORKER_DRAIN_DELAY_SECONDS=30` so an idle BullMQ worker stays within the command allowance; production retains the five-second default. |
| Notifications                 | Disabled in preview    | The Blueprint sets `EMAIL_TRANSPORT=disabled`; alert rules and durable delivery records remain implemented, but the public zero-cost preview does not claim outbound delivery. An operator may configure a reviewed free transport later without making it a release dependency.                                                                                                           |
| Observability                 | Render structured logs | The Blueprint sets `OBSERVABILITY_MODE=platform`, so redacted worker capture events use stdout/stderr collected by Render. Free-platform log retention, alerting, and availability are not production release evidence.                                                                                                                                                                    |

Official provider references: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase Free limits](https://supabase.com/pricing), [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups), [Upstash TLS](https://upstash.com/docs/redis/features/security), and [Upstash Free limits](https://upstash.com/pricing/redis).

### Preview release gate

Render Free cannot run the migration sequence before deployment. Before every preview rollout, run the gate once from an audited release workspace with `DATABASE_MIGRATION_URL` set to the Supabase direct TLS URL and `DATABASE_URL` set to the least-privilege session-pooler TLS URL:

```sh
pnpm install --frozen-lockfile
pnpm data:validate
pnpm db:migrate
pnpm db:seed
pnpm db:catalog-import
pnpm db:verify
```

If the release runner cannot reach Supabase's IPv6 direct endpoint, the session-mode pooler may be used as the preview-only migration fallback after a staging rehearsal. That exception does not satisfy the production direct-migration requirement. Never use Supavisor transaction mode with the current Postgres.js client because it does not support prepared statements.

The manual `Zero-budget preview database release gate` GitHub workflow runs the same ordered gate
from the reviewed default-branch commit. Configure `PREVIEW_DATABASE_MIGRATION_URL` and
`PREVIEW_DATABASE_URL` as protected `preview` environment secrets, dispatch the workflow once, and retain its
run as release evidence. Prefer the direct migration URL; use a session-mode pooler for the
migration secret only under the preview fallback above. The workflow never runs on push or a
schedule and refuses to continue when either secret is absent.

Stop the rollout on any failed command. Do not place the migration-owner URL in either Render service, do not run the gate concurrently, and do not substitute generated or synthetic live metrics.

The current importer treats the 60 external IDs and stable slugs as a reviewed full-snapshot
identity set. An addition, removal, or slug replacement fails closed. Before such a catalog change,
implement and rehearse an explicit retirement/replacement procedure that versions or archives the
old product and route, preserves prior import references, updates public-read behavior, and includes
rollback/forward-fix evidence. This limitation does not block status or evidence updates for the
existing identity set.

### First preview bootstrap

1. Create a Supabase Free project in the chosen region. Record its HTTPS project URL and anon key, create separate migration and runtime database roles, and capture the direct and shared session-pooler connection strings. Append `sslmode=require` (or stronger) without removing existing query parameters.
2. Create an Upstash Redis Free database near the compute region for the worker preview, confirm eviction is disabled, and copy its native TLS `rediss://` endpoint. Do not use the REST URL or token as `REDIS_URL`. The web preview can run without Redis and then uses a bounded per-process in-memory limiter; true production still requires Redis and fails closed without it.
3. Run the preview release gate above. This creates only canonical reference data and the reviewed production catalog; it does not fabricate observations.
4. Link the repository's default branch to a Render Blueprint and populate each `sync: false` value. Render supplies those values only during initial creation; later changes are made in each service's environment settings.
5. Confirm the `image.url` tags in `render.yaml` point to a CI-published SHA whose CI run and release-artifact image publication both succeeded. The web image is built with `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` by the GitHub release workflow, not by Render. Never add a server secret as a Dockerfile `ARG`.
6. After the Blueprint syncs, Render pulls `rwa-yield-router-worker-preview` and `rwa-yield-router-web` from the pinned GHCR tags. Verify `/health/live`, `/health/ready`, queue connectivity, scheduler registration, and one bounded idempotent ingestion job on the worker before treating the web preview as current.
7. Add the worker service origin (for example, `https://rwa-yield-router-worker-preview.onrender.com`) as the GitHub repository variable `RENDER_WORKER_URL`. The `preview-worker-wake.yml` workflow calls `/health/live` hourly with bounded cold-start retries. Scheduled GitHub Actions and free-service wakeups are best-effort, so this is not a continuous scheduler.
8. Run the public smoke suite and record the preview URL, release SHA, data counts, and known free-tier gaps. Do not call the result production.

### Render values that remain owner-supplied

| Variable or setting                 | Service                                       | Required value                                                                                              |
| ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_URL`                           | Web and worker preview                        | Identical canonical Render web HTTPS origin                                                                 |
| `DATABASE_URL`                      | Web and worker preview                        | Supabase shared session-pooler URL for the least-privilege runtime role, with `sslmode=require` or stronger |
| `REDIS_URL`                         | Worker preview required; web preview optional | Upstash native Redis URL using `rediss://`; omitted web preview uses bounded in-memory rate limits only     |
| `NEXT_PUBLIC_SUPABASE_URL`          | Web only                                      | Supabase project HTTPS URL                                                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Web only                                      | Browser-safe Supabase anon key                                                                              |
| `SECURITY_CONTACT_URL`              | Web and worker preview                        | Monitored HTTPS security-reporting destination                                                              |
| `RPC_URL_ETHEREUM` / `RPC_URL_BASE` | Web only                                      | Optional approved read-only RPC endpoints; leaving both unset keeps wallet analysis disabled                |
| `RENDER_WORKER_URL`                 | GitHub repository variable                    | Public Render worker-preview origin, with no path or credentials                                            |

`PREVIEW_DATABASE_MIGRATION_URL` and `PREVIEW_DATABASE_URL` belong only in protected GitHub
Actions `preview` environment secrets for the manual release gate. They are not Render variables, repository variables,
Docker build arguments, or application runtime configuration.

The Blueprint generates one shared `DATA_ENCRYPTION_KEY` and a worker-only `CRON_SHARED_SECRET`; neither value is committed. It explicitly selects `DEPLOYMENT_TIER=preview`, `EMAIL_TRANSPORT=disabled`, and `OBSERVABILITY_MODE=platform`, so no email, Sentry, or OTLP account is required. Keep the shared encryption key identical across services and never rotate it without an explicit encrypted-data migration. Telegram and any paid price provider remain disabled. The first administrator is still granted only after that identity signs in and the audited procedure below is completed.

### Why this is not production

This preview deliberately does not satisfy the release standard: the worker sleeps, outbound notifications are disabled, schedules can be late or missed, compute and datastore tiers have no production SLA, Supabase Free has no automatic backups/PITR, GitHub schedules are not a durable scheduler, and free quotas can suspend or throttle service. It is suitable for owner testing and a public product preview only. A production promotion still requires persistent worker compute, an enabled reviewed notification transport, managed durable queue semantics, restorable PostgreSQL backups, monitored capacity, current provider reviews, and every release gate in `REQUIREMENTS.md` and `TEST_PLAN.md`.

## Configuration and secrets

`.env.example` is the canonical variable list and contains safe local defaults but no values that grant access. Use only names accepted by `packages/config` and the database command environment.

### Non-secret configuration

| Variable                              | Purpose                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `development`, `test`, or `production`                                                  |
| `DEPLOYMENT_TIER`                     | `production` by default; `preview` only for an explicitly degraded deployment           |
| `TRUSTED_PROXY_MODE`                  | `none` by default; `render` trusts Render's first `x-forwarded-for` address             |
| `APP_URL`                             | Canonical origin; HTTPS is mandatory in production and at web image build time          |
| `LOG_LEVEL`                           | Structured log threshold                                                                |
| `OBSERVABILITY_MODE`                  | `external` (default) or explicit host-collected `platform` logs                         |
| `PORT`                                | Web listener port; defaults to 3000 in the image                                        |
| `WORKER_ENABLED`                      | Must be `true` for the worker process to start                                          |
| `WORKER_PORT`                         | Private worker health listener; defaults to 3001                                        |
| `WORKER_CONCURRENCY`                  | Bounded global concurrency                                                              |
| `WORKER_DRAIN_DELAY_SECONDS`          | Empty-queue polling delay from 5 to 300 seconds; preview uses 30 to conserve free quota |
| `MORPHO_API_URL`                      | Exact reviewed endpoint `https://api.morpho.org/graphql`                                |
| `REQUEST_TIME_PROVIDER_FETCH_ENABLED` | `true`; set `false` only for deterministic tests or an explicitly degraded deployment   |
| `EMAIL_TRANSPORT`                     | `disabled`, `resend`, or `console`; use `console` only outside production               |
| `EMAIL_FROM`                          | Verified sender when email delivery is enabled                                          |
| `NEXT_PUBLIC_SUPABASE_URL`            | Public HTTPS Supabase project URL, required at web build and runtime                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Browser-safe Supabase anon key, required at web build and runtime                       |

Any `NEXT_PUBLIC_` value is shipped to browsers and must be intentionally public. Provider secrets, database URLs, internal tokens, and notification credentials must never use that prefix.

### Server-only secrets

- `DATABASE_URL` — pooled least-privilege runtime connection
- `DATABASE_MIGRATION_URL` — direct migration connection, available only to one-off database jobs
- `REDIS_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SHARED_SECRET`
- `RPC_URL_ETHEREUM`, `RPC_URL_BASE`, and `RPC_URL_ARBITRUM` when their URLs contain credentials
- `PRICE_PROVIDER_API_KEY`
- `RESEND_API_KEY`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` when enabled
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

Run migrations as a single one-off release job. From a checked-out release workspace:

```sh
pnpm db:migrate
```

Or override the immutable worker image command:

```sh
node node_modules/@rwa-yield-router/database/dist/cli/migrate.js
```

The job uses `DATABASE_MIGRATION_URL`, falling back to `DATABASE_URL` only when the dedicated URL is absent, and exits before web traffic shifts. Do not run concurrent migration jobs. Migrations must be forward-compatible with the currently running web and worker. Use expand/migrate/contract changes across releases for destructive or long-running schema changes. Never run an unbounded backfill in the migration transaction.

On failure, stop the release and follow the database-migration runbook. Do not repeatedly rerun a partially understood migration.

### 6. Seed reference data and import the reviewed catalog

Run all four commands against the migrated database before starting the worker:

```sh
pnpm data:validate
pnpm db:seed
pnpm db:catalog-import
pnpm db:verify
```

`db:seed` creates canonical categories, assets, roles, yield-source classes, and methodology metadata; it does not insert live metrics. `db:catalog-import` performs the idempotent, provenance-preserving 60-record production import and uses a transaction-scoped PostgreSQL advisory lock. The equivalent immutable worker-image database commands are:

```sh
node node_modules/@rwa-yield-router/database/dist/cli/seed.js
node node_modules/@rwa-yield-router/database/dist/cli/import-production-catalog.js
node node_modules/@rwa-yield-router/database/dist/cli/verify.js
```

The static `data:validate` gate runs in CI before image publication. Review the import result, category counts, publication/gating states, and representative source records before continuing.

### 7. Deploy the worker

- Deploy one worker instance initially with `WORKER_ENABLED=true`, `DATABASE_URL`, and a TLS `REDIS_URL`. The current worker registers its canonical recurring schedules at startup; there is no separate schedule-enable switch in this release.
- Verify process liveness, database/Redis connectivity, migration version, queue registration, adapter configuration, and clean structured logs.
- Run one bounded health-check and one idempotent ingestion job per enabled adapter. Confirm provenance, status, freshness, and deduplication.

### 8. Deploy the web application

- Deploy the same release version with production canonical origin and secure headers.
- Keep the prior version available for rapid traffic rollback.
- Verify `/health/live` before routing traffic and `/health/ready` before full promotion.

### 9. Create the first administrator securely

1. The intended administrator signs in through the production auth provider and enables MFA.
2. A database/security operator verifies the immutable provider user ID out of band.
3. Run `pnpm db:grant-admin -- --subject=<provider-user-id> --reason="<audited reason>"` from the release workspace, or run the following command from the immutable worker image. Do not set a default password or retain bootstrap environment variables.

   ```sh
   node node_modules/@rwa-yield-router/database/dist/cli/grant-admin.js --subject=<provider-user-id> --reason="<audited reason>"
   ```

   The command accepts exactly one `--email=<signed-in-user-email>` selector in place of `--subject`.

4. A second operator reviews the role grant and audit event.
5. Verify the admin can access permitted pages and that a normal test user receives `403` from every admin endpoint.

### 10. Enable schedules and notifications

- Keep the initial worker deployment at one instance until recurring schedule registration, queue deduplication, and provider limits are verified. Scale only after observing idempotent behavior and capacity.
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

Production web and worker configuration fails closed unless one observability route is selected. The default `external` mode requires an HTTPS `SENTRY_DSN` or `OTEL_EXPORTER_OTLP_ENDPOINT`. Explicit `platform` mode relies on the deployment host's stdout/stderr collection; the worker converts `ErrorReporter.capture` calls into bounded, redacted `observability.error_captured` records. Platform mode removes the external account dependency, not the requirements for access control, retention, alert review, or production monitoring evidence.

## CI/CD

Pull requests run locked installation, format check, lint, type check, unit tests, migrations and integration tests against isolated PostgreSQL/Redis, E2E/accessibility tests, a production build, database verification, and a high-severity dependency audit.

The current default-branch workflow builds and publishes SHA-tagged web and worker images to GHCR only after the corresponding CI run succeeds. It does not provision infrastructure, migrate a database, deploy either service, or promote traffic. `render.yaml` supplies only the zero-budget preview services and points Render at immutable GHCR image tags from a checked release-artifact run; its Free tier cannot run the database release gate. After an owner-authorized provider deployment, manually dispatch the workflow with its `deployed_url` input to bind smoke evidence to the canonical HTTPS deployment.

Provider release flow:

1. Repeat all pull-request checks and record the release SHA.
2. Build immutable web/worker artifacts and record their digests and provenance.
3. Deploy to staging; apply migrations, seed reference data, import the catalog, and run E2E/smoke tests.
4. Require protected-production environment approval and verify a restorable backup.
5. Apply the production migration and catalog jobs, deploy one worker instance, deploy web, smoke test, and promote traffic.
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

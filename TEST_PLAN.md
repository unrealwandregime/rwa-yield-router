# RWA Yield Router Test Plan

Status: required verification plan for the first production release. Requirement IDs refer to REQUIREMENTS.md. No release gate may be bypassed solely to meet schedule.

## 1. Test objectives

Testing must prove that:

1. no production fact is fabricated or loses its source, confidence, status, or timestamp;
2. yield, fee, risk, comparison, and allocation results are decimal-safe, transparent, versioned, and deterministic;
3. user eligibility and constraints fail closed and are never silently relaxed;
4. public, user, admin, worker, and provider trust boundaries enforce validation and authorization;
5. provider and infrastructure failures degrade honestly without becoming false zeroes or crashing unrelated features;
6. the complete product is accessible, responsive, observable, secure, deployable, and usable against verified production data.

## 2. Test layers and tooling

| Layer         | Tooling                                                                                   | Runs                                           |
| ------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Static        | Formatter, ESLint, strict TypeScript, dependency and secret scanning                      | Local validation and every PR                  |
| Unit          | Vitest; deterministic clock; arbitrary-precision decimals; property tests where valuable  | Every PR                                       |
| Integration   | Vitest against isolated PostgreSQL and Redis; HTTP/provider stubs                         | Every PR                                       |
| Contract      | Zod/OpenAPI schema tests and recorded provider fixtures permitted by source terms         | Every PR; provider probes scheduled separately |
| End to end    | Playwright against a production build                                                     | Every PR and staging                           |
| Accessibility | Automated axe-compatible scans plus keyboard and screen-reader-oriented manual checks     | Every PR for key pages; full release review    |
| Visual        | Playwright screenshots at required states and viewports                                   | PR baselines and release review                |
| Security      | SAST, dependency/container/secret scans, targeted abuse tests, manual threat-model review | PR, scheduled, and release                     |
| Performance   | Browser budgets, API/load tests, database query plans, worker throughput                  | Staging and release                            |
| Smoke         | Read-only production checks plus a controlled authenticated/admin canary                  | Every deployment                               |

Tests must not require the public internet, production credentials, or wall-clock timing. External systems use protocol-faithful stubs in CI. Approved scheduled health probes and production smoke checks are separate and never mutate external financial systems.

## 3. Environments and test data

- Unit: no database or network.
- Integration: a fresh isolated PostgreSQL schema/database and Redis namespace per worker.
- E2E: production build with isolated database, Redis, fake auth transport, disabled notification delivery, and request-time provider fetching explicitly disabled so tests never use the public internet.
- Staging: production topology and a reviewed non-production dataset.
- Production: verified records only; smoke tests are read-only except controlled creation/deletion of marked canary account records and admin drafts.

Synthetic products, prices, APYs, and users are allowed only under tests/fixtures or isolated component examples. Fixture identifiers must make their test-only status explicit. Production seed and migration code must reject test fixture markers.

Provider fixtures retain retrieval metadata, adapter version, schema version, and provenance, contain no secrets or unnecessary personal data, and comply with source terms. Tests use fixed UTC instants and IANA timezone cases.

## 4. Canonical commands

    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm test:integration
    pnpm test:e2e
    pnpm test:a11y
    pnpm build
    pnpm db:verify
    pnpm data:validate
    pnpm smoke
    pnpm validate

pnpm validate is the local release-quality gate. CI installs from the committed lockfile with frozen resolution. No skipped test, focused-only test, ignored TypeScript error, or blanket lint suppression may be merged without an approved, time-bounded exception that does not affect release requirements.

## 5. Unit test matrix

### 5.1 Domain and decimal arithmetic

Cover R-DOM-001 through R-DOM-005, R-DB-004, and R-YLD-001 through R-YLD-005:

- product, route, yield source, return exposure, and access method cannot be conflated;
- all category, source, confidence, lifecycle, eligibility, and data-status enums are exhaustive;
- zero remains distinct from unknown, unavailable, stale, estimated, and awaiting verification;
- amount, rate, basis-point, duration, and currency units reject invalid combinations;
- decimal parse, serialization, comparison, quantization, and rounding at documented boundaries;
- no authoritative calculator accepts NaN, infinity, binary-float artifacts, zero/negative capital, or non-positive horizons;
- native gold yield is zero while gold-price change remains return exposure; lending yield belongs to the route.

### 5.2 Yield engine

Test with exact expected decimal results:

- zero and negative yield;
- base, borrower, Treasury, strategy, reward, and other incentive components;
- compatible versus incompatible component composition;
- management, protocol, entry, exit, performance, gas, and slippage fees;
- unknown fees and partial results rather than assumed zero;
- transaction-cost annualization across one day, seven days, one month, one year, and leap/day-count boundaries;
- small capital where costs make net APY negative;
- performance fee only on its eligible positive component;
- incentive active, expired, ending during the horizon, and missing end date;
- variable and issuer-reported flags;
- short observation windows;
- missing or stale inputs;
- deterministic calculation/input hashes and version retention;
- rounding at display precision never changes stored or ranking precision.

Use property tests for monotonic invariants: increasing a known cost cannot improve net APY; extending a horizon cannot increase the annualized impact of fixed one-time cost; identical inputs produce identical results.

### 5.3 Risk engine

Cover R-RSK-001 through R-RSK-006:

- every factor's zero-to-100 boundaries, explanation, source, confidence, and timestamp;
- initial category-specific weight sets for all six categories sum exactly to 100 percent;
- category selection uses the correct published version;
- composite band boundaries at 0, 20, 21, 40, 41, 60, 61, 80, 81, and 100;
- missing factors remain unavailable;
- lower confidence or less evidence never improves score or comparative adjusted APY;
- minimum evidence coverage behavior;
- each penalty component and full Comparative risk-adjusted APY;
- non-applicable factor versus missing applicable evidence;
- methodology draft/publish immutability and historical-version replay;
- deterministic effective-methodology selection, overlapping-interval rejection, relational weight validation, and unsupported calculation-version rejection;
- extreme, negative, and incomplete net APY inputs.

### 5.4 Routing engine

Cover R-OPT-001 through R-OPT-007:

- all five profiles expand to visible canonical constraints;
- allocations total exactly 100 percent within the documented tolerance;
- product, issuer, protocol, chain, category, stablecoin, DeFi, RWA, and gold caps;
- immediate, 24-hour, and seven-day liquidity minima;
- jurisdiction, investor class, KYC, confidence, scale, liquidity, incentive, lifecycle, freshness, and explicit exclusions;
- route-level transaction cost changes with capital, current asset/chain, and horizon;
- stale, paused, unavailable, and unverified routes are excluded by default;
- identical candidate snapshots and inputs produce byte-equivalent canonical results;
- input and candidate order do not change the result;
- tied optima use stable deterministic tie-breaking;
- solver output is independently revalidated and rejected on tolerance violation;
- infeasible cases return no allocation;
- conflict and minimal-relaxation diagnostics are stable, accurate, and do not mutate constraints;
- rationale and exclusion reason codes refer only to structured facts;
- report snapshot retains inputs, sources, timestamps, calculation, methodology, and solver versions.

Use generated feasible portfolios to assert all constraints and generated deliberately infeasible portfolios to assert fail-closed behavior.

### 5.5 Data and alerts

Cover:

- adapter response schemas, unit normalization, timestamps, provenance, and status mapping;
- source precedence, freshness, metric fitness, fallback, conflicting observations, and tie-breaking;
- missing data never becomes zero;
- stale transitions at each metric policy boundary;
- risk-factor evidence freshness at, before, and after each source-policy boundary, including proof that a new composite timestamp cannot refresh stale evidence;
- observation and job idempotency;
- import duplicate detection, review defaults, source validation, date windows, and CSV formula neutralization;
- alert threshold edges, change windows, event deduplication, cooldown, timezone and daylight-saving behavior;
- incentive, stale, depeg, lifecycle, eligibility, and redemption change events;
- channel fan-out, unsubscribe scope, retry classification, and spam prevention.

## 6. Integration test matrix

Each test starts with migrated empty storage and cleans its isolated namespace.

### 6.1 Database and migrations

- migrate an empty database to head;
- migrate the latest released schema to head with representative data;
- verify foreign keys, checks, unique keys, NUMERIC precision, UTC timestamps, lifecycle, and audit immutability;
- run seed/import twice and prove idempotency;
- compare the latest catalog payload hash, reject same-payload entity drift, preserve the append-only import audit, and fail closed on an unreviewed external-ID or slug-set change;
- prove production seed rejects fixture markers, missing sources, expired verification, and duplicates;
- verify important dashboard, screener, detail, alert, and stale-admin query plans use intended indexes.

### 6.2 Ingestion and jobs

- discover, ingest, normalize, append observation, select snapshot, publish outbox, and run downstream recalculation;
- for USDY, validate current/historical oracle ABI decoding, decimal-safe trailing-return
  annualization, EVM and Solana supply normalization, route AUM, canonical identity rejection, and
  the explicit absence of fabricated net-yield, liquidity, or risk observations;
- preferred source success and every fallback level;
- malformed, partial, oversized, wrong-content-type, slow, redirected, and rate-limited responses;
- approved-host validation and blocked localhost, private-network, link-local, credential-bearing, and redirect destinations;
- retries, jitter bounds, circuit open/half-open/close, provider concurrency, lock contention, duplicate delivery, crash/restart, and dead letter;
- raw observation remains while selected snapshot changes;
- provider outage preserves last valid value and marks it stale;
- source provenance survives historical rollup and derived risk result;
- both historical-yield API forms return each point's selected snapshot, actual source observation,
  canonical source, confidence/status layers, and timestamps; two points selected from different
  sources must never inherit one current route-level source.
- daily rollups ignore the open UTC day, select one deterministic closing available snapshot per
  route/day, remain unchanged on duplicate delivery, and replace the selected close only after a
  newly admitted correction; cutoff timestamps exclude later evidence, stable source/provenance
  keys break exact-time ties, capacity overflow writes nothing, and every copied field must equal
  the referenced immutable snapshot;
- ingestion completion atomically persists job counts and adapter health; final failure persists a
  redacted durable dead-letter record with matching retry/dead-letter counts;
- observation and typed-snapshot persistence rolls back together on either write failure; a retry of
  a duplicate observation reconciles a missing typed snapshot and reports stale evidence as stale;
- alert-event, delivery-outbox, and rule-state writes commit atomically; retrying an existing
  deduplicated event reconciles missing destination deliveries without duplicates;
- a risk recalculation with no admissible factor evidence persists `UNAVAILABLE` with a null score;
  partial proxy-based scores require at least one positively weighted sourced factor and remain
  explicitly provisional.

### 6.3 Auth, authorization, and admin

- email/passwordless callback, session creation/rotation/expiry, logout, and provider outage;
- anonymous, owner, different user, operator, and admin access for every protected resource;
- direct object-ID and server-action access cannot bypass authorization;
- admin create/edit/review/publish/reject/archive/override workflows;
- concurrent edit conflict and immutable published methodology;
- every manual change records actor, before/after, reason, source, verification date, request ID, and time;
- auth, public API, simulation, export, and admin rate limits are independent.

### 6.4 API, simulation, and notifications

- OpenAPI matches live request/response schemas;
- standard simulations exclude candidates with unknown transaction costs; explicit advanced research preserves after-cost net metrics as unavailable and labels separate before-cost metrics;
- cursor pagination has no gaps or duplicates under stable snapshot semantics;
- validation, bounded filters, stable errors, correlation IDs, ETags, cache invalidation, and public-field allowlists;
- saved simulations retain immutable calculation inputs and ownership; every candidate, exclusion,
  source-observation identifier, and exact decimal allocation is persisted against the current
  canonical route identifier and can be reopened as an analytical snapshot;
- saved comparisons enforce two to five unique current route targets, preserve requested order,
  rebuild public route-slug URLs, and scope list, update, and archive operations to the authenticated
  owner;
- saved screener views reject unknown filters, sort keys, and duplicate or unknown columns, and
  scope list, update, and archive operations to the authenticated owner;
- alert event-to-delivery transitions, provider retry, permanent failure, deduplication, and in-app persistence;
- webhook signature, timestamp/replay, and malformed-body rejection;
- safe CSV and report generation under row, size, and URL limits.

## 7. End-to-end scenarios

Run on Chromium, Firefox, and WebKit for critical public and authenticated flows; use Chromium for the full matrix.

1. New user signs in, sets jurisdiction/risk/chain preferences, signs out, and returns.
2. Visitor opens dashboard, follows every category card, and sees timestamps, confidence, and aggregate coverage.
3. User filters and sorts the screener, changes columns, shares the URL, saves a view, and exports formula-safe CSV.
4. User opens product and route pages, historical charts, risk factors, access terms, contracts, and the source drawer.
5. User compares up to five entries and every narrative statement matches displayed facts.
6. User runs a feasible simulation, inspects constraints/exclusions, saves it, and prints/downloads the analytical report.
7. User runs an infeasible simulation and receives no allocation plus correct conflict suggestions.
8. User creates, tests, triggers, cools down, disables, and unsubscribes from an alert.
9. User creates and removes watchlist, comparison, and saved-simulation records.
10. Read-only wallet analysis recognizes supported holdings, labels unknown positions, and never requests a signature, approval, or transaction.
11. Wallet analysis is truthfully disabled when its provider is absent.
12. Admin creates, reviews, and publishes a sourced product and route; a public user then sees them.
13. Admin publishes a methodology version; new results use it while historical results retain the old version.
14. Anonymous and ordinary users cannot reach admin pages, endpoints, actions, or data.
15. Stale and partial data display correctly; source fallback is labelled.
16. Provider failure degrades affected components and does not crash public browsing.
17. Dark and light modes work at mobile, tablet, desktop, and wide-terminal sizes.
18. Legal notices appear on simulations, reports, methodology, and relevant data views.

Assert that no page exposes executable transaction data or uses prohibited guarantee/advice language.

## 8. Accessibility and visual QA

Automated scans cover landing, dashboard, screener, each category template, product, route, comparison, simulator, auth, account, alerts, status, and admin.

Manual checks cover:

- complete keyboard navigation and visible focus;
- skip links, landmarks, headings, form labels, errors, and status announcements;
- table headers, sort state, column controls, and responsive table alternative;
- modal focus trap, return focus, Escape behavior, and background inertness;
- chart name, summary, tooltip access, and equivalent tabular data;
- contrast in dark/light themes, color-independent meaning, zoom to 200 percent, and reduced motion.

Visual snapshots cover loading, skeleton, empty, no result, error, partial, stale, degraded, restricted, and ineligible states at 390x844, 768x1024, 1440x900, and 1920x1080. Review overflow, clipped labels, chart collisions, sticky regions, long names, large decimals, low contrast, and timestamp/confidence visibility.

Release target: no automated serious or critical accessibility violation and no known WCAG 2.1 AA blocker in core workflows.

## 9. Security verification

- dependency, lockfile, container, static-code, and secret scans;
- no critical vulnerability; no high vulnerability remains where a safe fix exists;
- manual review of session, role, object authorization, admin endpoints, provider fetch, redirects, webhooks, queues, exports, logs, and client bundles;
- injection tests for SQL/filter builders, XSS/provider text, CSV formulas, headers, redirects, and contract/source URLs;
- CSRF/origin and authentication-redirect tests for state changes, including a public HTTPS origin behind an internal HTTP reverse proxy; session fixation and brute-force/rate-limit tests;
- SSRF tests including DNS/redirect rebinding defenses and response limits;
- every JSON mutation rejects unsupported content types and buffers no more than its documented application limit, including chunked bodies without `Content-Length`;
- queue poisoning, duplicate/replay, oversized payload, and unknown-job tests;
- error and structured-log inspection for secrets, tokens, personal data, and unsafe raw payloads;
- verify secure production cookies, CSP, headers, robots exclusions, and private-page cache controls.

Security findings record severity, evidence, owner, fix, and retest. Critical findings block all deployment; high findings block release unless no safe fix exists and explicit security/product acceptance documents compensating controls.

## 10. Performance and resilience gates

Run performance tests with an isolated scale fixture of at least 60 routes and representative history, plus enough additional data to exercise pagination and indexes. Scale-fixture size is not publication evidence. Release evidence separately reports researched, admitted, and gated production records per category.

Initial production budgets:

- public API cached-read p95 at or below 500 ms and p99 at or below 1 s under expected load;
- uncached bounded screener p95 at or below 1.5 s;
- deterministic simulation with 500 candidates p95 at or below 3 s;
- Core Web Vitals at the 75th percentile: LCP at or below 2.5 s, INP at or below 200 ms, CLS at or below 0.1 on normal mobile/broadband profiles;
- no unbounded response, query, export, chart payload, or job;
- ingestion completes within its freshness window under normal provider behavior;
- worker restart and duplicate job delivery create no duplicate observation or alert event.

Run controlled database, Redis-cache, worker, provider, and notification failures. Verify readiness, telemetry, preserved last-valid data, stale transitions, retry/dead-letter behavior, and recovery without manual data repair.

Budgets may change only with measured evidence and an updated requirement or decision; regression relative to the accepted baseline blocks release.

## 11. Production data verification

Before publication, validate:

- all six categories have real, current, source-attributed coverage;
- researched, admitted, and gated counts are reported separately for every category; a 60-record research bundle must never be described as 60 published routes;
- every category has at least one admitted record before `releaseStatus` can be `ready`, without reclassifying gated candidates to meet the gate;
- a configured database passes migrations and contains a current production-catalog import whose researched, admitted, and gated totals match the validated bundle;
- each product/route has a verification date and correct lifecycle;
- official source URLs, verified contracts, chain, issuer/protocol, access, redemption, and yield-source classification;
- no assumed global retail eligibility;
- native gold has zero yield unless a verified mechanism exists;
- all material displayed metrics trace to observations;
- stale, unavailable, estimated, and awaiting-verification records display honestly;
- category and overall counts are reported without inventing entries to meet targets.

Perform a sample manual reconciliation for every adapter and category, including APY components, fees, AUM/TVL, liquidity, NAV, eligibility, and timestamps. Record reviewer, date, sampled IDs, source links, result, and exceptions in release evidence.

## 12. CI, deployment, and release evidence

Pull requests run frozen install, formatting, lint, type checks, unit tests, integration tests, production build, OpenAPI drift, migration verification, and security scans. E2E and accessibility run on every change affecting application behavior and as a required aggregate check.

Main reruns all gates, validates migrations in the protected environment, deploys worker and web, then runs smoke tests. Scheduled workflows run dependency checks, allowed source-health probes, link validation, and stale-manual-metadata reports.

Production smoke verifies:

- public URL, /health/live, /health/ready, metadata, robots, sitemap, and canonical URLs;
- dashboard, screener, all category templates, product, route, comparison, methodology, sources, status, and legal pages;
- one feasible and one infeasible deterministic simulation;
- sign-in and a disposable user-owned saved object;
- controlled admin authorization and a draft-only canary action;
- provider/job health, freshness, error tracking, and notification configuration;
- no secret, fixture, default credential, placeholder, or private page in public HTML or indexing.

The release record includes commit, schema and methodology versions, environment, commands, test counts/results, browser versions, accessibility report, security findings, performance measurements, data coverage by category, provider health, smoke evidence, rollback point, public URL, reviewer, and timestamp.

## 13. Exit criteria

Release requires:

- every Definition of Done item in REQUIREMENTS.md checked with evidence;
- zero failing or skipped required test;
- all migrations pass from empty and last release;
- formatter, lint, strict type check, unit, integration, E2E, accessibility, build, and security gates pass;
- no unresolved critical security issue;
- production-data review passes with no fabricated metric;
- visual review passes all states and required viewports;
- performance and resilience budgets pass;
- production deployment is accessible and smoke-tested;
- final review confirms sources, confidence, timestamps, gold/yield semantics, admin authorization, disclosures, and the non-custodial/no-execution boundary.

A local build, partial deployment, mock screen, incomplete dataset, disabled core workflow, or inaccessible public URL does not satisfy the exit criteria.

# RWA Yield Router Repository Rules

This file is the permanent operating contract for every human and automated contributor. It applies to the entire repository. A more local AGENTS.md may add stricter rules for its subtree, but it may not weaken these rules.

## 1. Product boundary

RWA Yield Router is a non-custodial analytics and routing-intelligence product. It compares yield, liquidity, access, redemption, risk, and data quality for on-chain cash and real-world-asset routes.

The product may read public addresses after explicit user connection, calculate deterministic simulations, rank routes with a published methodology, create reports, link to official destinations, and send informational alerts.

It must never:

- accept or custody user funds;
- ask for, receive, log, or store private keys or seed phrases;
- request wallet signatures merely to connect;
- request token approvals;
- sign, construct, submit, or relay executable transactions;
- present an allocation as individualized investment advice;
- describe variable or simulated returns as guaranteed;
- fabricate production APY, price, NAV, AUM, TVL, liquidity, risk, eligibility, redemption, audit, or reserve data;
- label asset-price appreciation as yield.

Any change that crosses one of these boundaries requires an explicit product decision, legal and security review, and an update to the architecture and threat model before implementation.

## 2. Sources of truth

Keep these documents current with the implementation:

- REQUIREMENTS.md: traceable product and acceptance requirements.
- ARCHITECTURE.md: system boundaries, data model, flows, and technical decisions.
- DATA_SOURCES.md: provider registry, licences, source precedence, freshness, and production coverage.
- RISK_METHODOLOGY.md: risk factors, category weights, penalties, confidence handling, and methodology versions.
- SECURITY.md: threat model, trust boundaries, secrets, retention, and incident response.
- TEST_PLAN.md: required verification and release evidence.
- DEPLOYMENT.md: environments, configuration, migration, and release procedure.
- OPERATIONS_RUNBOOK.md: monitoring and incident playbooks.

When behavior, schema, commands, providers, risk logic, or operational assumptions change, update the relevant document in the same pull request. Code that contradicts an accepted requirement is a defect, not an undocumented product decision.

## 3. Repository shape and ownership

Use the TypeScript-first pnpm workspace and Turborepo layout described in ARCHITECTURE.md:

- apps/web: Next.js App Router application, public API, account UI, and server-authorized admin UI.
- apps/worker: ingestion, rollups, scoring, alerts, and other asynchronous jobs.
- packages/database: Drizzle schema, migrations, queries, and database test utilities.
- packages/domain: canonical types, Zod schemas, enums, units, and business invariants.
- packages/data-adapters: provider contracts, normalization, provenance, and fallback selection.
- packages/yield-engine: decimal-safe yield and fee calculations.
- packages/risk-engine: versioned risk factors, composites, penalties, and explanations.
- packages/routing-engine: deterministic constrained optimizer and infeasibility diagnostics.
- packages/ui: accessible design-system components and financial-data formatters.
- packages/config: validated server and client configuration.
- docs: decision records and supporting research.
- scripts: repeatable import, validation, verification, and operations commands.
- tests: cross-application fixtures, integration tests, end-to-end tests, and production smoke tests.

Business calculations belong in packages, not React components, route handlers, database hooks, or job processors. Adapters return normalized domain results and provenance; they do not write directly to presentation tables.

## 4. Canonical domain rules

Keep these concepts distinct in schema, APIs, calculations, and UI:

1. Product: the underlying instrument or token.
2. Route: a particular way to acquire, hold, lend, or deposit a product.
3. Yield source: the economic activity that generates income.
4. Return exposure: non-yield price exposure.
5. Access method: issuer mint or redemption, DEX purchase, lending deposit, vault deposit, or another verified method.

Use the canonical categories:

- TOKENIZED_TBILL
- STABLECOIN_VAULT
- DEFI_LENDING
- MONEY_MARKET_TOKEN
- GOLD_BACKED_TOKEN
- CASH_EQUIVALENT

Use the canonical yield-source classes:

- TREASURY_COUPON
- MONEY_MARKET_INCOME
- BORROWER_INTEREST
- REPO_INCOME
- VAULT_STRATEGY
- STAKING_OR_PROTOCOL_REWARD
- TOKEN_INCENTIVE
- BASIS_OR_HEDGING_STRATEGY
- OTHER_VERIFIED
- NO_NATIVE_YIELD

A native gold token has zero native yield unless a sourced issuer mechanism proves otherwise. Gold-price movement is return exposure. Yield from lending or vaulting that token belongs to the route and must identify the lending or strategy source.

Unknown, unavailable, stale, estimated, and zero are different states. Never coerce a missing value to zero. Never use truthiness to interpret a financial value.

## 5. Data and provenance rules

Every material production metric must be traceable to a source observation containing:

- source identifier, name, type, and canonical URL;
- observed, fetched, and, where applicable, verified timestamps;
- confidence classification;
- raw value when safe and permitted;
- normalized value and unit;
- data status;
- adapter version.

The default source priority is:

1. official issuer or protocol API;
2. on-chain derivation from verified contracts;
3. recognized third-party API with compatible terms;
4. manually curated and sourced record;
5. unavailable.

Selection must also account for metric fitness, freshness, verification state, and source health. Fallbacks may not silently change units or semantic meaning. Preserve competing observations for auditability.

Before adding a provider:

- verify the official documentation, licence or terms, rate limits, and attribution rules;
- prefer an API, subgraph, RPC, oracle, or allowed feed over scraping;
- do not scrape a disallowed source;
- document ownership, expected cadence, timeouts, limits, fallback behavior, and removal procedure;
- add contract tests, normalization tests, health checks, and a fixture captured in accordance with the provider's terms.

Production seed records must represent currently verifiable products or routes and include source attribution and verification dates. Test fixtures and component examples must be unmistakably isolated from production. No seed command may insert synthetic live metrics.

All outbound ingestion requests require protocol and hostname validation, an allowlist or explicitly reviewed destination, DNS and redirect protections, timeouts, response-size limits, content-type checks, rate limiting, and redacted errors.

## 6. Financial and quantitative correctness

- Store financial amounts, rates, and percentages in PostgreSQL NUMERIC columns with documented scale.
- Use the repository decimal abstraction for arithmetic. JavaScript number is allowed only for non-authoritative chart coordinates or solver boundaries with explicit, tested conversion tolerances.
- Carry explicit units. A percentage, decimal ratio, basis points, token amount, fiat amount, duration, and timestamp are not interchangeable.
- Normalize time to UTC in storage. Preserve a user's IANA timezone only for display and notification scheduling.
- Separate every APY component, fee, entry cost, exit cost, and slippage estimate.
- Include holding-period effects when annualizing transaction costs.
- Mark unknown fees as unknown; do not assume zero.
- Keep gross APY, net APY, and Comparative risk-adjusted APY separate.
- A risk adjustment is a transparent comparative ranking penalty, not an expected-loss forecast.
- Record calculation inputs, source observation identifiers, data timestamp, and methodology version with every material derived result.
- Risk factors may be unavailable. Low-confidence or missing evidence must not be interpreted as low risk.
- Allocation is a deterministic constrained optimization. Identical canonical inputs and data snapshots must produce identical outputs.
- Allocation totals must equal 100 percent within the documented decimal tolerance, or the result is invalid.
- When constraints are infeasible, return no allocation and explain the conflicting constraints. Never weaken a user's constraints silently.

Quantitative changes require focused unit tests, boundary cases, property or invariant tests where useful, and a reviewer who can follow the formula from inputs to displayed output.

## 7. Database rules

- Drizzle migrations are append-only after reaching a shared environment. Never edit an applied migration.
- Use foreign keys, check constraints, uniqueness constraints, and explicit delete behavior.
- Use UUID or similarly non-sequential public identifiers; never expose authorization decisions through guessable identifiers.
- Use TIMESTAMPTZ and UTC.
- Use NUMERIC for authoritative amounts and rates.
- Preserve point-in-time observations and methodology versions.
- Use soft deletion or lifecycle status for business records that must remain auditable.
- Manual curated records are versioned; publication never overwrites history.
- Admin changes record actor, timestamp, before value, after value, reason, source, and verification date.
- All tenant- or user-owned queries must scope by the authenticated subject on the server.
- Add indexes with the query they support, then verify important queries with EXPLAIN ANALYZE on representative data.
- Migrations must be tested from an empty database and from the latest released schema.

Never run a destructive migration or production backfill without a rollback or forward-fix plan, a backup verification step, and explicit deployment documentation.

## 8. TypeScript and code standards

- Use strict TypeScript across all packages.
- Do not introduce any, ignored TypeScript errors, blanket lint disables, or unchecked type assertions as shortcuts.
- Validate every untrusted boundary with Zod or an equivalent repository-standard schema: environment variables, HTTP input, provider output, queue payloads, imports, webhooks, and persisted JSON.
- Prefer discriminated unions for status-bearing values and exhaustive switches for domain enums.
- Use small, explicit functions. Keep I/O at the edge and domain logic pure.
- Do not duplicate formulas or status mapping in UI code.
- Prefer named exports for shared modules.
- Return structured domain errors; do not parse human-readable messages in callers.
- Never log secrets, session tokens, full provider payloads containing sensitive data, or unnecessary personal data.
- External URLs, contract addresses, Markdown, and provider text are untrusted. Encode output and never render provider HTML.
- Add comments for reasons, invariants, and non-obvious financial assumptions, not for restating syntax.
- Remove dead code. Production-relevant TODO, FIXME, placeholder, fake-data, and skipped-test markers block release unless an approved issue and safe disabled behavior are documented.

Run the formatter rather than manually fighting style. Do not change generated files by hand.

## 9. Web, API, and accessibility rules

- Prefer React Server Components and server-side data access. Add client components only for interaction that requires browser state.
- Server-authorize every protected action. Hidden navigation and client-side guards are never authorization.
- Public API routes are versioned, paginated, validated, rate limited, cached where safe, and documented in OpenAPI.
- Public serializers use allowlists and never expose private admin, auth, raw-ingestion, or internal audit fields.
- Use a stable error envelope and correlation identifier.
- Apply secure headers, CSP, referrer policy, safe redirects, and HTTPS-only production cookies with appropriate SameSite settings.
- Expensive filtering and exports require bounded input, pagination, cancellation, and rate limits.
- CSV exports must prevent spreadsheet-formula injection.
- Shareable URLs may contain public filters and public comparison identifiers only, never tokens or private simulation data.
- Admin, account, and private simulation routes must be excluded from search indexing.

Target WCAG 2.1 AA. All interactive behavior must work by keyboard, preserve visible focus, expose names and state to assistive technology, respect reduced motion, and meet contrast requirements. Tables need real headers and accessible sorting. Charts need text summaries or equivalent tabular data and keyboard-accessible tooltips where applicable.

Implement and test loading, skeleton, empty, no-results, error, partial-data, stale-data, degraded-provider, restricted, and ineligible states. Timestamps and confidence labels remain visible at every viewport.

## 10. Authentication, authorization, and secrets

- Use provider-supported email authentication and secure server sessions.
- Authorization roles are least-privilege and checked in server code for every protected read and write.
- Admin actions require an authenticated admin role and produce immutable audit records.
- Never use a public-prefixed environment variable for a secret.
- Environment access goes through the validated configuration package; do not read process.env throughout the codebase.
- Commit a complete .env.example containing names and safe descriptions only.
- Use separate credentials per environment and provider.
- Verify webhook signatures before parsing or dispatching business actions.
- Rate-limit authentication, public API, exports, simulations, provider callbacks, and admin job controls.
- Redact errors returned to clients and logs.

If a credential appears in code, logs, screenshots, documentation, or Git history, treat it as compromised: stop, revoke or rotate it, remove the exposure safely, and follow SECURITY.md.

## 11. Jobs and operational behavior

Jobs must be idempotent, bounded, observable, and safe to retry. Use stable idempotency keys, provider-specific concurrency and rate limits, exponential backoff with jitter, maximum attempts, circuit breakers, job locks, dead-letter handling, and correlation IDs.

Do not acknowledge a job until its durable effects are committed. Do not hold a database transaction open across an external network call. Make cache invalidation and derived-score recalculation explicit after successful observations.

Every adapter and recurring job exposes:

- last attempted and successful run;
- duration and outcome;
- records read, accepted, rejected, and changed;
- retry and dead-letter counts;
- source freshness and stale-record counts;
- redacted error category;
- adapter and job version.

The liveness endpoint reports process life only. Readiness verifies the dependencies needed to serve safe responses, with bounded timeouts. A provider outage degrades affected data and marks it stale or unavailable; it must not crash the application or erase the last valid observation.

## 12. Canonical commands

Keep these root commands functional and documented:

    pnpm install --frozen-lockfile
    pnpm dev
    pnpm format
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm test:integration
    pnpm test:e2e
    pnpm test:a11y
    pnpm build
    pnpm validate
    pnpm db:migrate
    pnpm db:seed
    pnpm db:verify
    pnpm data:validate
    pnpm smoke

pnpm validate is the local release-quality gate: formatting, lint, type checking, unit tests, integration tests, production build, and other non-credentialed checks that can run reliably in CI. Keep the lockfile committed and use frozen installs in CI.

If a package requires an additional command, add it through Turbo and document it; do not create a competing root workflow.

## 13. Test rules

Follow TEST_PLAN.md. At minimum:

- a bug fix includes a regression test;
- a new adapter includes schema, normalization, fallback, rate-limit, timeout, malformed-response, and health tests;
- a schema change includes migration and rollback/forward-compatibility verification;
- a quantitative change includes exact examples, boundary cases, missing and stale data, and decimal-rounding coverage;
- an authorization change includes allowed and denied cases at the server boundary;
- a UI change includes keyboard and accessibility checks plus all relevant data states;
- a job change includes idempotency, retry, lock, dead-letter, and partial-failure tests;
- no test may depend on the public internet, wall-clock timing, or production credentials;
- use deterministic clocks, seeded randomness, and isolated databases;
- never weaken assertions, skip tests, or suppress tooling solely to make CI pass.

Production data verification and post-deployment smoke checks are release evidence, not replacements for automated tests.

## 14. Working agreement

Before editing:

1. Read the relevant requirements, architecture, security, methodology, and test sections.
2. Inspect nearby code, schemas, and tests.
3. Check the working tree and preserve unrelated user changes.
4. Identify whether current provider documentation or live data must be verified.

While editing:

1. Keep changes narrowly reviewable and commit logical units.
2. Preserve backward compatibility or provide an explicit migration.
3. Add observability without sensitive data.
4. Update documentation and tests with behavior.
5. Do not make irreversible external changes without the authority described in the project brief.

Before handoff:

1. Review the complete diff.
2. Run the proportional test set, then pnpm validate for release candidates.
3. Search production paths for TODO, FIXME, placeholder, mock, lorem, fake data, skipped tests, disabled lint, TypeScript suppression, and secrets.
4. Confirm formulas, statuses, timestamps, confidence, sources, and legal notices are correctly presented.
5. State exactly what was verified and what still requires credentials or a deployed-environment check.

## 15. Review and release gates

Reviewers must be able to answer:

- Is every displayed material fact sourced, timestamped, and confidence-labelled?
- Are product, route, yield source, return exposure, and access method still separate?
- Can missing or stale data be mistaken for zero or current data?
- Are calculations decimal-safe, transparent, versioned, and reproducible?
- Does authorization happen on the server for every protected object and action?
- Can any external input cause SSRF, XSS, injection, open redirect, queue abuse, or spreadsheet injection?
- Does provider failure degrade safely?
- Are user constraints honored without hidden relaxation?
- Does the UI avoid advice, custody, execution, certainty, and prohibited claims?
- Are new behavior, tests, docs, migrations, and operational playbooks complete?

The application is not complete until the full Definition of Done in REQUIREMENTS.md passes in a publicly accessible production deployment. A landing page, mock screen, partial dataset, local build, or untested deployment is not a releasable product.

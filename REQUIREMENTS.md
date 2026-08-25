# RWA Yield Router Requirements

Status: normative product specification for the first complete production release.

Requirement identifiers are stable. Tests, architecture decisions, pull requests, and operational evidence should reference them. A requirement may be clarified without changing its identifier; a materially different outcome requires a new identifier and an explicit decision record.

## 1. Mission and release outcome

RWA Yield Router shall be a production-grade, non-custodial analytics and routing-intelligence platform for:

1. tokenized T-bills;
2. stablecoin vaults;
3. DeFi lending markets;
4. money-market tokens;
5. gold-backed tokens and gold yield routes;
6. cash-equivalent on-chain products.

The product shall let a user determine where yield is available, what generates it, what remains after fees and estimated transaction costs, how quickly a route can be exited, what access constraints apply, what risks and data limitations exist, how stable the yield has been, and which feasible routes best meet explicit portfolio constraints.

The launch is one complete release. Internal milestones may be deployed to private preview environments, but the public product shall not launch with mock screens, fabricated metrics, incomplete core workflows, or an unpopulated required category.

Core positioning: “Compare where yield comes from, what risks you take, and how easily you can exit.”

Secondary positioning: “The risk-adjusted yield intelligence layer for on-chain cash and real-world assets.”

## 2. Actors

| Actor               | Needs and permissions                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous visitor   | Browse public market, product, route, comparison, methodology, source, legal, and status information; run an unsaved public simulation within rate limits.                      |
| Authenticated user  | All public access plus preferences, saved views, watchlists, comparisons, simulations, alerts, reports, and optional read-only wallet analysis.                                 |
| Administrator       | Server-authorized product and route curation, source and eligibility management, publication workflow, job controls, methodology publication, and delivery/data-quality review. |
| Operator            | Restricted operational visibility and job remediation appropriate to role; no implicit authority to change methodology or product facts.                                        |
| Data adapter        | Read approved external sources, normalize observations, and report health through bounded authenticated jobs.                                                                   |
| Public API consumer | Read allowlisted public data under versioning, validation, pagination, caching, and rate limits.                                                                                |

Permissions shall be least-privilege and composable. Authentication alone shall not confer administrative access.

## 3. Domain vocabulary

### R-DOM-001 Product taxonomy

The database, API, calculations, and UI shall keep these entities separate:

- Product: the underlying instrument or token.
- Route: a specific way to acquire, hold, lend, or deposit a product.
- Yield source: the economic activity that generates income.
- Return exposure: price exposure that is not yield.
- Access method: issuer mint, issuer redemption, DEX purchase, lending deposit, vault deposit, or another verified path.

### R-DOM-002 Categories

Every published product shall belong to one of:

- TOKENIZED_TBILL
- STABLECOIN_VAULT
- DEFI_LENDING
- MONEY_MARKET_TOKEN
- GOLD_BACKED_TOKEN
- CASH_EQUIVALENT

A route may add exposure or risk characteristics beyond its product category, but it shall not erase the identity of its underlying product.

### R-DOM-003 Yield sources

Every published yield component shall use one of:

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

### R-DOM-004 Status semantics

Zero, unknown, unavailable, estimated, stale, and awaiting verification shall be distinct machine-readable and visible states. A missing value shall never be silently stored, calculated, sorted, exported, or displayed as zero.

### R-DOM-005 Gold semantics

A native gold-backed token shall show native yield of zero unless a verified issuer mechanism produces income. Gold price movement shall be labelled return exposure. A lending or vault route shall attribute its APY to borrower interest or its verified strategy, identify the underlying gold token, and disclose the additional protocol, smart-contract, liquidity, and relevant liquidation risks.

## 4. Product boundaries

### R-BND-001 Non-custodial operation

The platform shall not accept deposits, take custody, store private keys or seed phrases, request approvals, sign transactions, submit transactions, or automate swaps, deposits, withdrawals, or rebalances.

### R-BND-002 Analytical output

The platform may rank products, calculate deterministic portfolio simulations, read public balances after explicit wallet connection, produce print-ready or PDF reports, send informational alerts, and link to official issuer or protocol pages.

### R-BND-003 No execution affordance

No simulator, comparison, report, wallet analysis, API response, or call-to-action shall contain an executable transaction payload or imply that the platform will execute an allocation. Official outbound links shall be clearly identified and validated.

### R-BND-004 No fabricated production data

Production records shall use verified external observations or properly sourced manual records. Synthetic data is permitted only in isolated tests and component fixtures that cannot enter the production database or deployment.

### R-BND-005 No guaranteed or advisory claims

Simulations and rankings shall not be presented as realized-return forecasts, guarantees, individualized investment advice, or actuarially precise expected-loss estimates.

## 5. Data ingestion, provenance, and production coverage

### R-DATA-001 Adapter contract

The system shall provide a pluggable adapter interface whose implementations support appropriate subsets of:

- product discovery;
- product metadata;
- yield;
- TVL or AUM;
- liquidity;
- price;
- NAV;
- utilization;
- historical data;
- health checks.

### R-DATA-002 Source diversity and precedence

The product shall not depend on one provider. Selection and fallback shall prefer:

1. official issuer or protocol API;
2. on-chain derivation from verified contracts;
3. recognized third-party API under compatible terms;
4. manually curated, sourced, reviewed record;
5. unavailable.

Metric suitability, freshness, confidence, and source health shall participate in selection. All competing observations shall remain auditable.

### R-DATA-003 Observation provenance

Every material observation shall store:

- source ID, name, type, and canonical URL;
- observedAt;
- fetchedAt;
- verifiedAt when applicable;
- confidence;
- raw value when safe and permitted;
- normalized value;
- unit;
- status;
- adapter version.

Derived metrics shall retain the observation IDs and methodology or calculation version used.

### R-DATA-004 Confidence

Supported confidence classifications are:

- VERIFIED_OFFICIAL
- DIRECT_API
- ONCHAIN_DERIVED
- ISSUER_REPORTED
- THIRD_PARTY
- MANUALLY_VERIFIED
- ESTIMATED
- STALE
- UNAVAILABLE

The UI and API shall expose confidence and source timestamps for material metrics.

### R-DATA-005 Freshness

Freshness policies shall be configurable by provider and metric. Initial operational targets are:

| Metric                         | Target collection or review cadence |
| ------------------------------ | ----------------------------------- |
| Prices                         | 5 minutes                           |
| DeFi APY                       | 15 minutes                          |
| DeFi liquidity and utilization | 15 minutes                          |
| TVL                            | 30 minutes                          |
| NAV                            | Source publication cadence          |
| Issuer AUM                     | Daily or source publication cadence |
| Eligibility and legal metadata | Weekly review                       |
| Risk score                     | Event-driven and at least hourly    |
| Historical rollups             | Daily                               |

Freshness is measured from the observation's economic timestamp, not merely the fetch time. Data beyond its policy shall be visibly stale and shall not be silently treated as current.

### R-DATA-006 Ingestion reliability

Adapters and jobs shall implement bounded exponential backoff with jitter, rate limits, circuit breakers, idempotency, duplicate-prevention locks, dead-letter handling, stale detection, quality alerts, and a legally appropriate raw-ingestion audit trail.

### R-DATA-007 Adapter health

Administrators and operators shall see last attempt, last success, duration, accepted/rejected/changed record counts, retry and dead-letter status, freshness, adapter version, and redacted error categories.

### R-DATA-008 Provider compliance

Every provider shall have documented official source URLs, terms or licence assessment, rate limits, attribution, data ownership, fallback, and safe removal. Disallowed scraping shall not be used. External requests shall be protected against SSRF, malicious redirects, oversized responses, and indefinite waits.

### R-DATA-009 Production coverage

Before launch:

- all six categories shall contain real, currently verifiable products or routes;
- at least five credible entries per category shall be preferred where the market supports it;
- the complete platform shall aim for at least 60 verified products and routes;
- count targets shall never justify inventing or duplicating an entry;
- genuine category limitations shall be documented;
- every seeded product shall include source attribution and verification date;
- paused, closed, deprecated, restricted, unavailable, and ineligible products shall be labelled accurately;
- eligibility shall not default to global retail access.

### R-DATA-010 Manual import

The repository shall provide a versioned JSON or CSV import format, schema validation, duplicate detection, source validation, review status, effective date, re-verification or expiration date, and CSV formula-injection protection. Imports shall default to unpublished review state.

### R-DATA-011 Manual publication

Authorized administrators shall be able to add, edit, archive, verify, and publish products and routes without a code deployment. Publication shall create versioned audit history.

### R-DATA-012 Data degradation

Provider failure shall retain the last valid observation, update its freshness state, and degrade affected screens without crashing the product. If no safe value exists, the product shall show Unavailable, Estimated, Stale, or Awaiting verification as applicable.

## 6. Data model

### R-DB-001 Core entities

The normalized PostgreSQL model shall support at least:

users, user_profiles, user_preferences, roles, sessions, assets, stablecoins, chains, issuers, protocols, custodians, administrators, auditors, oracles, products, product_categories, product_routes, yield_sources, product_yield_sources, contracts, product_contracts, source_registry, source_observations, yield_snapshots, yield_history_rollups, apy_components, price_snapshots, nav_snapshots, tvl_aum_snapshots, liquidity_snapshots, utilization_snapshots, risk_factor_snapshots, composite_risk_snapshots, fee_schedules, eligibility_rules, jurisdictions, redemption_terms, transfer_restrictions, custody_records, audit_records, proof_of_reserve_records, data_quality_events, adapter_health, job_runs, watchlists, watchlist_items, saved_comparisons, route_simulations, route_simulation_allocations, alert_rules, alert_events, notification_deliveries, and admin_audit_logs.

### R-DB-002 Relationships and history

The model shall support multiple chains and contracts per product, multiple routes per product, multiple sources per metric, point-in-time observations, historical methodology versions, soft deletion and archival, versioned manual records, and a publish/review workflow.

### R-DB-003 Eligibility dimensions

Eligibility shall support jurisdictions and retail, accredited, qualified, professional, and institutional investor classifications. Unknown eligibility is a first-class state and shall not be guessed.

### R-DB-004 Integrity

The schema shall use database migrations, appropriate foreign keys, uniqueness and check constraints, explicit delete behavior, supporting indexes, UTC timestamps, and decimal-safe NUMERIC financial fields. Authoritative stored amounts or percentages shall not use binary floating point.

## 7. Yield and fee calculations

### R-YLD-001 APY components

The system shall represent separately:

- base APY;
- borrower-paid APY;
- Treasury or money-market yield;
- strategy APY;
- reward-token APY;
- other incentive APY;
- gross APY;
- management fee;
- performance fee;
- protocol fee;
- estimated entry cost;
- estimated exit cost;
- estimated slippage;
- net APY.

Each component shall identify unit, period, source, confidence, status, and whether it is variable or promotional.

### R-YLD-002 Compatibility

Only economically and mathematically compatible components may be combined. Compounding convention, source period, annualization, performance-fee assumption, and incentive end treatment shall be documented and versioned.

### R-YLD-003 Net APY

Calculations shall use decimal arithmetic. For a selected capital and holding period, net APY shall account for recurring fees, expected performance fees, and annualized entry, exit, gas, and slippage costs. Unknown fees shall produce a qualified or ranged result rather than an assumed zero-fee result.

### R-YLD-004 Disclosures

Every relevant view shall identify unknown fees, estimated costs, variable yield, incentive contributions and known expiry, short observation windows, and issuer-reported rather than independently derived APY.

### R-YLD-005 Reproducibility

A calculated result shall retain its normalized inputs, observation IDs, time horizon, rounding policy, calculation version, and timestamp.

## 8. Risk engine

### R-RSK-001 Factors

The comparative framework shall assess:

- liquidity;
- redemption;
- issuer or counterparty;
- custody;
- smart contract;
- oracle;
- chain;
- stablecoin or depeg;
- market price;
- concentration;
- yield instability;
- incentive dependency;
- governance and upgradeability;
- operational;
- legal and eligibility uncertainty;
- data quality.

Category methodology may define additional explicit factors such as vault strategy, collateral quality, liquidation, or bad debt, provided each maps transparently to sourced inputs.

### R-RSK-002 Factor result

Each factor shall contain a zero-to-100 score, explanation, input metrics, source references, confidence, last-calculated timestamp, and methodology version. A factor may be unavailable and shall not be forced to zero.

### R-RSK-003 Composite interpretation

Higher scores mean higher comparative risk:

- 0–20: Low comparative risk
- 21–40: Low to moderate
- 41–60: Moderate
- 61–80: High
- 81–100: Very high

### R-RSK-004 Category methodology

All six categories shall have documented category-specific weights. Weight sets and penalty functions shall be administrator-configurable through a draft-review-publish workflow, immutable after publication, and versioned. Historical scores shall retain the methodology version used.

### R-RSK-005 Missing and low-confidence evidence

The engine shall penalize low confidence or missing material evidence under a documented method. It shall not treat uncertainty as low risk. The UI shall expose unavailable factors and the resulting confidence effect.

### R-RSK-006 Comparative risk-adjusted APY

The engine shall calculate and label “Comparative risk-adjusted APY” by subtracting transparent, versioned comparative penalties from net APY. Penalty components shall cover applicable liquidity, redemption, issuer, custody, smart-contract, concentration, yield-instability, incentive-dependency, market or depeg, and data-quality risks.

The metric shall be described as a comparative ranking adjustment, not an actuarially precise expected-loss forecast or a guarantee.

## 9. Routing and portfolio simulation

### R-OPT-001 Input

The simulator shall accept:

- capital amount;
- current asset and chain;
- holding period;
- jurisdiction;
- investor classification;
- whether KYC is acceptable;
- preferred and excluded chains;
- preferred assets;
- risk profile;
- minimum AUM or TVL;
- minimum available liquidity;
- maximum allocations by product, issuer, protocol, chain, stablecoin, DeFi, RWA, and gold;
- minimum percentage liquid immediately, within 24 hours, and within seven days;
- whether incentive yield is acceptable;
- minimum data confidence;
- excluded products, protocols, and issuers.

### R-OPT-002 Profiles

The product shall provide Capital Preservation, Conservative, Balanced, Yield Seeking, and Custom profiles. Presets shall resolve to visible, editable constraints and versioned defaults.

### R-OPT-003 Determinism

Allocation shall use a deterministic, testable constrained optimization model, not an opaque AI model. Identical canonical inputs and data snapshots shall produce identical results.

### R-OPT-004 Objective and constraints

The objective is to maximize blended Comparative risk-adjusted APY while satisfying:

- allocation equals exactly 100 percent within the defined decimal tolerance;
- upper bounds for products, issuers, protocols, chains, categories, gold, DeFi, stablecoins, and other exposure groups;
- immediate, 24-hour, and seven-day liquidity minima;
- KYC preference;
- jurisdiction and investor eligibility;
- minimum scale and liquidity;
- minimum confidence;
- incentive acceptance;
- explicit exclusions;
- no allocation to stale, paused, unavailable, or unverified routes unless an explicitly labelled advanced research mode allows them.
- no standard-mode allocation to a route whose user-specific entry, exit, gas, or slippage costs are unavailable.

Constraints shall never be relaxed silently.

### R-OPT-005 Infeasibility

When no feasible allocation exists, the system shall return no allocation, identify the binding or conflicting constraints, and deterministically show which minimal constraint relaxations would permit one or more routes. Suggestions are explanatory and require user action before a rerun.

### R-OPT-006 Output

The result shall include:

- suggested analytical allocations;
- gross blended APY;
- net blended APY after user transaction costs, or an explicit unavailable state;
- Comparative risk-adjusted APY after user transaction costs, or an explicit unavailable state;
- provider-reported net and Comparative risk-adjusted APY before user transaction costs when an explicitly selected advanced research scenario uses unknown costs;
- weighted risk score;
- yield-source breakdown;
- immediate, 24-hour, and seven-day liquidity;
- RWA, DeFi, gold, and stablecoin exposure;
- issuer, protocol, and chain concentration;
- incentive dependency;
- data-confidence score;
- estimated transaction costs;
- transaction-cost evidence status and every before-cost research assumption;
- product-level rationale;
- excluded-product explanations;
- methodology version;
- data timestamp.

Every output shall display: “Analytical portfolio simulation based on current and historical data. It is not individualized investment advice and does not guarantee returns.”

### R-OPT-007 Report

The user shall be able to download a PDF or print-ready analytical report that reproduces inputs, constraints, allocation, metrics, exclusions, sources, timestamps, versions, and disclosures without adding unsupported claims.

## 10. Public and account application

### R-APP-001 Required pages

The complete product shall provide:

1. landing page;
2. market overview dashboard;
3. universal yield screener;
4. category page for each of six categories;
5. product detail;
6. route detail;
7. product and route comparison;
8. routing simulator;
9. methodology;
10. data sources and confidence;
11. alerts;
12. watchlist;
13. saved simulations;
14. read-only wallet analysis;
15. user settings;
16. sign-in and account creation;
17. legal disclaimer;
18. privacy policy;
19. terms of use;
20. status or data health;
21. role-based admin application.

### R-APP-002 Dashboard

The dashboard shall show tracked AUM, tracked TVL, product count, active-route count, median gross and net APY by category, best Comparative risk-adjusted APY, highest gross APY, most liquid routes, largest 24-hour APY changes, largest seven-day TVL or AUM changes, stale products, liquidity warnings, NAV deviations, incentive-dependent yield, and average redemption time by category.

Each category card shall show product and route count, AUM or TVL, median APY, best net APY, average comparative risk score, and freshness. Every card shall link to the corresponding filtered screener.

Aggregates with incomplete coverage shall show their coverage and status rather than implying completeness.

### R-APP-003 Universal screener

The screener shall provide these columns:

Product, symbol, route, category, issuer or protocol, underlying asset, yield source, chain, gross APY, net APY, base APY, incentive APY, Comparative risk-adjusted APY, risk score, AUM or TVL, available liquidity, redemption period, KYC status, eligibility, confidence, and updated timestamp.

It shall filter by category, asset, chain, protocol, issuer, custodian, yield source, APY ranges, risk, scale, liquidity, redemption, KYC, jurisdiction, investor classification, minimum investment, native versus route yield, organic versus incentive yield, retail or institutional access, confidence, and freshness.

It shall sort by gross APY, net APY, Comparative risk-adjusted APY, AUM or TVL, liquidity, lowest risk, fastest redemption, APY stability, confidence, and recency.

It shall support shareable filter URLs, column visibility, saved views, bounded pagination or virtualization, safe CSV export, and a mobile alternative.

The default screener view shall show admitted routes. Users may explicitly include or isolate
admission-gated research records; changing that scope must not make a gated route eligible for
simulation or any admitted-data aggregate.

Authenticated users may create, read, rename, update, and archive private screener views. A saved view contains only validated canonical filters, a supported sort key, and a non-empty unique subset of allowlisted columns. Applying a saved view updates the public filter URL; it never places the private saved-view identifier or owner data in that URL.

### R-APP-004 Product and route detail

Every detail page shall provide:

- identity: name, symbol, category, issuer, protocol, route, chains, status, official links, verified contracts with explorer links, confidence, and timestamp;
- yield: current, gross, net, comparative adjusted, base, incentive, fees, source, seven-, 30-, and 90-day averages, volatility, and history;
- scale and liquidity: AUM or TVL, available exit liquidity, utilization, volume, relevant DEX liquidity, history, and NAV premium or discount;
- risk: composite and every factor, explanations, sources, confidence, version, and historical change;
- access: KYC, jurisdictions, investor types, minimum, mint, redemption, settlement, and transfer restrictions;
- infrastructure: custodian, administrator, auditor, oracle, proof of reserves, upgradeability, governance, contract verification, and audit links;
- source drawer: sources, supported metric, source type, fetched and verified times, and confidence.

Unavailable fields shall remain visible with an honest state where their absence is material.

### R-APP-005 Comparison

Users shall compare up to five products or routes across gross, net, and comparative adjusted APY; stability; incentive dependency; AUM or TVL; liquidity; redemption; KYC; eligibility; minimum investment; fees; relevant risk factors; NAV deviation; confidence; and yield sources.

A comparison requires two to five unique current route targets. Authenticated users may create, read, rename, replace the targets of, and archive private saved comparisons. Opening a saved comparison reconstructs the public route-slug URL so sharing never exposes a private saved-comparison identifier.

A deterministic written comparison may describe only facts and differences derivable from displayed data. Every sentence shall be traceable to those inputs; invented causal explanations are prohibited.

### R-APP-006 Visual design and data states

The interface shall be institutional, serious, analytical, dark by default, and fully implemented in light mode. Tables shall be dense but readable. Decoration shall not resemble gambling, meme coins, or excessive glassmorphism. Green and red are primarily directional; amber indicates warning; unavailable data is neutral.

All relevant components and pages shall implement loading, skeleton, empty, no-result, error, partial-data, stale-data, degraded-provider, restricted, ineligible, mobile, tablet, desktop, and wide-terminal states.

### R-APP-007 Accessibility

The target is WCAG 2.1 AA, including keyboard access, visible focus, semantic HTML, accessible names and descriptions, contrast, reduced motion, accessible tables, chart labels, tooltips, and equivalent data summaries.

### R-APP-008 No placeholder production content

Production pages shall contain no lorem ipsum, fake metrics, sample users, default credentials, non-functional core controls, or unlabeled placeholder copy.

## 11. Accounts, wallet analysis, and alerts

### R-USR-001 Authentication and settings

The product shall provide mature provider-supported email authentication, account settings, jurisdiction, risk and chain preferences, saved filters, watchlists, saved comparisons, saved simulations, and alert management.

### R-USR-002 Object authorization

Every read and write of user-owned resources shall be server-authorized against the authenticated subject. Identifiers alone shall not grant access.

Saved comparison and saved-view mutations shall pass same-origin CSRF validation, bounded account and network rate limits, strict request validation, and owner-scoped database predicates. Removal is archival so user history is not silently hard-deleted.

### R-USR-003 Read-only wallet

Wallet connection is optional and read-only. It shall not require a signature merely to connect, request approvals, or create executable transactions. Analysis may show recognized holdings, current routes, category and stablecoin exposure, issuer, protocol, and chain concentration, current estimated yield, and analytical alternatives.

Unrecognized positions and incomplete chain or provider coverage shall be labelled. If no supported provider is configured, the feature shall be explicitly disabled with a truthful explanation rather than simulated.

### R-ALR-001 Alert conditions

Users shall be able to alert on:

- APY above or below threshold;
- APY change over a chosen period;
- incentive end;
- TVL or AUM decline;
- liquidity deterioration;
- utilization spike;
- NAV deviation;
- risk-score increase;
- confidence downgrade;
- stale data;
- redemption change;
- eligibility change;
- issuer or protocol warning;
- stablecoin depeg;
- vault allocation change;
- product pause or closure.

### R-ALR-002 Channels and delivery

The product shall support in-app, email, and Telegram adapters. Telegram shall activate only when valid owner-provided credentials are configured. Development shall have a safe console transport.

### R-ALR-003 Delivery controls

Alerts shall use deterministic evaluation, event deduplication, configurable cooldowns, user IANA timezones, retry with bounds, delivery logs, unsubscribe and disable controls, a test-notification function, and spam prevention.

## 12. Administration

### R-ADM-001 Capabilities

Server-authorized administrators shall be able to:

- add and edit products and routes;
- manage issuers, protocols, chains, custodians, and sources;
- review discovered records;
- publish or reject records;
- archive or mark products paused, restricted, closed, or unavailable;
- edit eligibility, redemption, transfer, and source records;
- review stale data and override an incorrect observation with a reason;
- review adapter health, rerun bounded jobs, and inspect failures;
- manage draft risk weights and publish methodology versions;
- review alert delivery and security-relevant audit logs;
- export data-quality reports.

### R-ADM-002 Audit

Every manual change shall record administrator identity, UTC timestamp, before value, after value, reason, source, verification date, request correlation ID, and affected record version.

### R-ADM-003 Publication workflow

Material records and methodology changes shall support draft, reviewed, published, rejected, archived, and superseded states as appropriate. Publication is explicit and versioned. Published historical facts shall not be silently overwritten.

### R-ADM-004 Authorization

Admin navigation, pages, APIs, server actions, job controls, exports, and underlying queries shall enforce authorization on the server. Unauthorized access shall reveal no private data and shall create appropriate security telemetry.

## 13. API

### R-API-001 Public resources

The documented read API shall expose allowlisted public fields for products, routes, latest and historical yield, risk scores, liquidity, AUM and TVL, sources, categories, comparison data, and public methodology versions.

Every historical-yield point shall identify its actual selected snapshot, source observation, and source registry record rather than inheriting the route's current identity source. The point shall expose allowlisted confidence, status, calculation/selection versions, and observed, fetched, verified, as-of, and rollup-cutoff timestamps where applicable.

### R-API-002 Contract

The API shall be versioned and documented through OpenAPI. It shall provide validated inputs, bounded pagination, stable machine-readable errors, correlation IDs, source timestamps, confidence, cache controls, and ETags or equivalent conditional validation.

### R-API-003 Protection

Public endpoints shall be rate limited and safe against expensive unbounded queries. Private admin fields, user records, secrets, raw sensitive observations, and internal security metadata shall not be serialized.

### R-API-004 Future keys

The design shall include a disabled-by-default API-key framework for future paid access without weakening anonymous rate limiting or exposing key material.

### R-API-005 Internal endpoints

Administration, jobs, and provider callbacks shall use separate internal endpoints and authorization, with webhook signatures or service identity as appropriate. Public API credentials shall not authorize internal endpoints.

## 14. Security, privacy, and legal communication

### R-SEC-001 Threat coverage

The system shall explicitly address authentication bypass, broken object-level authorization, admin escalation, SQL injection, XSS, CSRF where relevant, SSRF, malicious source URLs, open redirects, rate-limit abuse, credential exposure, dependency risk, webhook forgery, queue poisoning, expensive-filter denial of service, CSV formula injection, unsafe contract rendering, external HTML, sensitive logging, session fixation, and brute force.

### R-SEC-002 Controls

Required controls include server authorization, boundary validation, output encoding, parameterized database access, rate limits, secure headers, CSP, referrer policy, HTTPS-only production cookies, suitable SameSite settings, webhook verification, audit logs, redacted errors, dependency scanning, protected admin endpoints, safe outbound requests, timeouts, and response-size limits.

### R-SEC-003 Secrets

Secrets shall exist only in protected environment or secret stores, never in code, logs, screenshots, Git history, client bundles, or documentation. A public-prefixed environment variable may contain only intentionally public client configuration.

### R-SEC-004 Privacy

Collect and retain the minimum user data needed for accounts, preferences, alerts, and audit obligations. Document retention and deletion. Wallet addresses are user data and shall not be assumed anonymous. Production logs shall not contain auth tokens or unnecessary personal data.

### R-LEG-001 Notices

Relevant pages, simulations, reports, exports, and outbound paths shall clearly communicate:

- the platform is informational and analytical;
- it is not individualized investment advice;
- it does not guarantee returns;
- APYs are variable;
- historical data does not guarantee future results;
- Comparative risk-adjusted APY is a platform methodology, not a realized-return forecast;
- availability depends on jurisdiction and investor status;
- users must verify eligibility with the issuer or protocol;
- the platform neither takes custody nor executes transactions;
- third-party data may be delayed, incomplete, or inaccurate.

### R-LEG-002 Prohibited wording

“Risk free,” “guaranteed,” “safe,” “best investment,” and “protected principal” shall not be used unless an exact sourced context and professional legal review support it.

### R-LEG-003 Legal pages

Disclaimer, privacy policy, and terms shall be editable content with version and effective date. They shall be marked for professional legal review before commercial scale.

## 15. Reliability, operations, performance, and discovery

### R-OPS-001 Health and telemetry

The product shall provide /health/live and /health/ready, provider health, job visibility, structured logs, redacted error tracking, correlation IDs, freshness metrics, adapter failures, queue metrics, alert-delivery metrics, web vitals, API and ingestion latency, cache hit rate, failed-job rate, and stale-record count.

### R-OPS-002 Safe degradation

External provider, cache, notification, or non-critical job failure shall not make sourced historical data disappear or crash unrelated browsing. The product shall clearly identify degraded dependencies and data states.

### R-OPS-003 Runbooks

Operations documentation shall cover provider outage, migration failure, worker backlog, stale data, incorrect APY, compromised credential, alert failure, rollback, product pause, security incident, and user-data deletion.

### R-PERF-001 Web performance

The dashboard shall use server-side data fetching where appropriate, bounded and cached aggregates, small client bundles, virtualized or paginated large tables, optimized chart rollups, cancellation, and graceful timeout behavior.

Release performance budgets and load profiles are defined in TEST_PLAN.md and shall be measured on production-like data rather than empty tables.

### R-PERF-002 Database performance

Historical records shall be paginated, N+1 access eliminated, important indexes justified by real queries, and representative query plans inspected before release.

### R-SEO-001 Public discovery

Public pages shall provide descriptive titles, meta descriptions, canonical URLs, Open Graph and social metadata, sitemap, robots rules, suitable structured data, and shareable product and comparison pages.

Admin, account, alert, watchlist, wallet, and private simulation pages shall not be indexed.

## 16. Delivery and deployment

### R-DEL-001 Repository

The project shall use a TypeScript-first pnpm workspace with a committed lockfile, reproducible commands, Dockerfiles, local Docker Compose for PostgreSQL and Redis, validated environment configuration, database migrations, and GitHub Actions.

### R-DEL-002 Canonical commands

The repository shall provide and verify:

- pnpm install;
- pnpm dev;
- pnpm lint;
- pnpm typecheck;
- pnpm test;
- pnpm test:integration;
- pnpm test:e2e;
- pnpm build;
- pnpm validate;
- pnpm db:migrate;
- pnpm db:seed.

### R-DEL-003 CI

Pull requests shall run frozen installation, formatting, lint, type checks, unit and integration tests, production build, and security checks. Main shall additionally validate migrations, deploy through protected environments, and run post-deployment smoke tests. Scheduled workflows shall check dependencies, approved provider health, links, and stale manual metadata.

### R-DEL-004 Production topology

The production deployment shall include a production-capable Next.js host, persistent worker host, managed PostgreSQL, managed Redis, protected secrets, automated controlled migrations, error monitoring, and health checks. Configurations shall remain portable.

### R-DEL-005 Initial release procedure

The release shall:

1. provision database and Redis;
2. configure protected secrets;
3. apply tested migrations;
4. deploy worker and web;
5. create the initial administrator through a secure one-time procedure;
6. import and publish verified product metadata;
7. run ingestion;
8. run production smoke tests;
9. verify schedules, notification configuration, public pages, metadata, sitemap, canonical URLs, error monitoring, and health;
10. record and open the public URL.

No default credential shall be published. Owner input is required only at the exact credential, authentication, paid-key, Telegram, email, or domain step that cannot be completed through the authenticated environment.

## 17. Verification requirements

### R-TST-001 Automated suites

The repository shall contain unit, isolated-database integration, Playwright end-to-end, accessibility, security, visual, performance, migration, and production-smoke coverage described in TEST_PLAN.md.

### R-TST-002 Required quality gate

Before release, formatting, lint, type checks, unit tests, integration tests, end-to-end tests, accessibility checks, production build, migration tests, dependency and security scans, final code review, and final UI review shall pass. Tests shall not be skipped or weakened merely to produce a green pipeline.

### R-TST-003 Final content review

Release review shall search for and resolve production-relevant TODO, FIXME, placeholder, mock, lorem, hardcoded secret, skipped test, disabled lint, TypeScript suppression, and fake-data occurrences.

### R-TST-004 Production verification

The deployed product shall be opened and exercised. Review shall verify navigation, mobile rendering, admin authorization, attribution, APY and risk explanations, timestamps, gold semantics, non-guarantee language, and absence of transaction execution.

## 18. Definition of Done

The release is complete only when all of the following are evidenced:

- [ ] All six categories are visible and populated with verified products or routes.
- [ ] Production screens and seed paths contain no fabricated live data.
- [ ] Sources, confidence, and observation timestamps are visible.
- [ ] Dashboard and linked category cards work.
- [ ] Screener filtering, sorting, saved/shareable views, and safe export work.
- [ ] Every category, product, and route page works.
- [ ] Comparison of up to five entries works and its narrative is traceable.
- [ ] Routing simulation, reports, constraint enforcement, and infeasibility diagnostics work.
- [ ] Risk factors, composite scoring, penalties, confidence, and methodology versions are transparent.
- [ ] Gross and net APY calculations and assumptions are transparent.
- [ ] Historical yield, scale, liquidity, NAV, and risk charts work where observations exist.
- [ ] Alerts, authentication, watchlists, comparisons, and saved simulations work.
- [ ] Read-only wallet analysis works or is explicitly and truthfully disabled without a provider.
- [ ] Admin curation, publication, job, methodology, delivery, and audit workflows work.
- [ ] Role and object authorization work at server boundaries.
- [ ] Ingestion, history, stale detection, fallback, and provider degradation work.
- [ ] All migrations and canonical local commands pass.
- [ ] Formatting, lint, type checks, unit, integration, end-to-end, accessibility, and build pass.
- [ ] Security review has no unresolved critical issue and no unresolved high issue with a safe available fix.
- [ ] Public production deployment and smoke tests succeed.
- [ ] Documentation, legal, methodology, source, security, deployment, and runbook content are complete.
- [ ] No repository or deployment secret is exposed.
- [ ] No production placeholder remains.
- [ ] No price appreciation is represented as yield.
- [ ] No screen implies guaranteed returns, individualized advice, custody, or transaction execution.

Completion may be reported only after the public production URL is accessible and tested. Final delivery evidence shall include the URL, repository and branch, deployed topology, implemented features, product and route counts by category, connected and manual sources, commands and results, security, accessibility, and performance results, admin creation procedure, owner configuration still required, known limitations, and immediate operating instructions.

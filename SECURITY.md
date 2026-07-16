# RWA Yield Router Security Policy and Threat Model

## Security posture

RWA Yield Router is a non-custodial analytics system. It does not accept deposits, hold private keys or seed phrases, request token approvals, sign transactions, or execute swaps, deposits, withdrawals, or rebalances. A wallet connection, when enabled, is read-only and requires no signature merely to view an address.

Non-custodial does not mean low impact. The service handles user accounts and preferences, publishes financial analytics that may influence decisions, runs privileged ingestion and administration workflows, and stores credentials for infrastructure and data providers. The primary security objectives are:

1. Prevent unauthorized access to user and administrator data.
2. Prevent unauthorized publication or manipulation of products, observations, methodology, APY, eligibility, and risk results.
3. Preserve provenance and audit history.
4. Keep infrastructure, provider, notification, and signing secrets confidential.
5. Remain available under provider failure, abusive queries, and ingestion faults.
6. Avoid presenting stale, unverified, or corrupted information as current or authoritative.

This document is part of the production control set. Material deviations require a security review and an auditable decision.

## Scope and assumptions

In scope:

- Public Next.js web application and read API
- Account, watchlist, comparison, simulation, alert, and optional read-only wallet features
- Server-side admin application and internal job endpoints
- Worker, scheduler, adapters, cache, queue, PostgreSQL, and object/log storage
- Authentication, email, Telegram, error monitoring, RPC, issuer, protocol, oracle, and market-data integrations
- CI/CD, build artifacts, runtime configuration, backups, and operator access

Out of scope but treated as untrusted dependencies:

- Issuer, protocol, chain, oracle, explorer, DEX, and third-party API correctness
- User endpoint security and browser extensions
- Security of a linked issuer or protocol site after the user leaves this application
- Smart contracts and assets analyzed by the platform; listing is not endorsement or audit

Assumptions:

- Production uses managed PostgreSQL and Redis with TLS, private networking where available, encryption at rest, backups, and provider access logging.
- Authentication is delegated to a mature provider; authorization remains this application’s responsibility.
- Only the worker performs scheduled external ingestion. Public requests cannot choose arbitrary outbound destinations.
- Production is HTTPS-only and administrative access requires a dedicated role and multi-factor authentication.

## Assets, actors, and abuse goals

### Assets

- User identity, jurisdiction, investor classification, preferences, watchlists, alerts, simulations, and linked public wallet addresses
- Admin roles, sessions, audit logs, review decisions, and unpublished records
- Verified products, routes, observations, methodology versions, provenance, and historical snapshots
- Database, cache, queue, backups, logs, deployment controls, and build artifacts
- Database, Redis, auth, provider, RPC, email, Telegram, webhook, internal-job, and monitoring credentials
- Service availability and the integrity of alerts and downloadable reports

### Threat actors

- Unauthenticated opportunistic attackers and automated bots
- Authenticated users attempting cross-account access or expensive-query abuse
- Compromised user or administrator accounts
- Malicious or compromised upstream data sources and webhook senders
- Supply-chain attackers targeting dependencies, CI, registries, or build artifacts
- Insiders or operators exceeding their assigned authority
- Attackers able to influence DNS, redirects, CSV content, external metadata, contract addresses, or queue payloads

### High-value abuse cases

- Publish a false APY, eligibility rule, product status, or risk score.
- Escalate a normal account to administrator or bypass server-side authorization.
- Read or alter another user’s saved objects.
- Exfiltrate secrets through SSRF, logs, client bundles, error reports, or CI output.
- Poison ingestion or alert queues and make forged events appear legitimate.
- Exhaust the service with broad comparisons, long historical ranges, or optimizer inputs.
- Redirect users to an attacker-controlled site disguised as an issuer, explorer, or contract link.

## Trust boundaries

| Boundary                              | Trusted side                                               | Untrusted side                                                                   | Required controls                                                                                           |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser to web/API                    | Server runtime and validated application state             | Browser input, cookies, query strings, wallet addresses, uploaded/imported files | TLS, secure headers, validation, authentication, CSRF protection, output encoding, rate limits              |
| Web/API to auth provider              | Server-side callback handling and verified claims          | Redirect parameters, authorization responses, provider availability              | Exact redirect allowlist, state/nonce/PKCE, issuer/audience checks, session rotation, no open redirects     |
| Web/worker to PostgreSQL              | Parameterized ORM/query layer                              | User-controlled filters and imported source data                                 | Least-privilege roles, parameterization, transaction boundaries, row ownership checks, query budgets        |
| Web/worker to Redis and queues        | Versioned job producers/consumers                          | Serialized payloads, retries, duplicate or delayed jobs                          | TLS/auth, schema validation, bounded payloads, idempotency, allowlisted job types, DLQ isolation            |
| Worker to external sources            | Adapter code and outbound policy                           | DNS, URLs, redirects, response bodies, upstream claims                           | Host allowlist, DNS/IP checks, timeouts, size limits, content-type validation, circuit breakers, provenance |
| Webhooks to application               | Signature verifier and replay store                        | Public webhook request                                                           | Raw-body signature check, timestamp tolerance, replay prevention, endpoint-specific limits                  |
| Application to notification providers | Sanitized templates and verified destinations              | Provider response and delivery events                                            | Provider-scoped keys, no secrets in message bodies, webhook verification, delivery audit log                |
| Admin browser to admin services       | Server-side RBAC and audited actions                       | Navigation state, client claims, imported records                                | MFA, step-up for sensitive actions, object-level checks, reason/source requirement, immutable audit log     |
| CI/CD to production                   | Protected branch, reviewed workflow, protected environment | Pull-request code, dependency scripts, build logs                                | OIDC/short-lived credentials, environment approval, pinned actions, secret masking, artifact provenance     |
| Public wallet data to account data    | User-authorized address association                        | RPC/indexer results and unrecognized positions                                   | No signature/approval, chain/address validation, explicit incompleteness labels, deletion support           |

Data crossing a trust boundary remains untrusted even if it came from an “official” source. Provenance and source confidence do not replace input validation.

## Authorization model

- Authentication establishes an identity; it never grants ownership or an admin role by itself.
- Every protected handler performs server-side authorization after loading the target object. Client-side hidden navigation is only a usability feature.
- User-owned objects are selected by both immutable object ID and authenticated owner ID. Guessable or supplied IDs alone are insufficient.
- Administrative roles are stored server-side, deny by default, and checked at the action level. At minimum separate `USER`, `DATA_REVIEWER`, `ADMIN`, and `SECURITY_ADMIN` capabilities.
- Product publication, methodology publication, role assignment, credential-management actions, and destructive bulk actions require recent authentication. Methodology publication and production role elevation require a second reviewer.
- Role and session changes take effect immediately by consulting authoritative server state for sensitive operations; long-lived role claims are not trusted.
- Internal endpoints use service identity and network or gateway restrictions in addition to an application credential. They are never protected only by obscurity.
- Admin actions write append-only audit records with actor, request/correlation ID, time, target, before/after values, source, reason, and outcome.

Production administrators must use unique accounts, provider-enforced MFA, and no shared credentials. There are no default admin users or passwords.

## Required security controls

### Input, database, and output safety

- Validate every request, route parameter, query filter, imported record, job payload, webhook, and provider response against a strict schema. Reject unknown fields on security-sensitive inputs.
- Use decimal-safe types for financial values and parameterized ORM/query APIs. Raw SQL must use bound parameters and receive explicit review.
- Bound pagination, date ranges, comparison size, optimizer variables, export row counts, request body size, and execution time. Cancel work when the request disconnects where supported.
- Encode text for its output context. External descriptions are rendered as plain text; arbitrary upstream HTML, Markdown HTML, SVG, and scriptable URLs are not rendered.
- Mutation endpoints use POST/PATCH/DELETE, verify content type, and do not mutate on GET.
- Errors returned to clients use stable codes and correlation IDs, not stack traces, SQL, provider bodies, tokens, or internal hostnames.

### Browser and session security

- Production cookies are `Secure`, `HttpOnly`, scoped narrowly, and use `SameSite=Lax` or `Strict` unless a documented auth callback requires a narrower exception.
- Rotate the session identifier on sign-in, privilege change, recent-auth completion, and credential recovery. Revoke sessions on passwordless-link replay, account disablement, and administrator role change.
- Cookie-authenticated mutations require same-origin enforcement and anti-CSRF tokens. OAuth/OIDC uses exact redirect URIs, `state`, `nonce`, and PKCE.
- CORS is denied by default. Public read API origins and methods are explicitly configured; credentials are not allowed with wildcard origins.
- Redirect destinations are server-generated or matched against an exact local-path or host allowlist. Supplied absolute URLs are not accepted for post-auth navigation.
- Authentication and recovery endpoints use account-aware and IP-aware throttles, generic responses, exponential delay, and provider-supported bot protection to limit brute force and account enumeration.

Minimum production headers:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-<per-request>'; style-src 'self' 'nonce-<per-request>'; img-src 'self' data: https:; connect-src 'self' <explicit providers>; upgrade-insecure-requests
```

Production CSP is generated with a per-request nonce. `unsafe-inline` and `unsafe-eval` are not permitted for scripts. Any provider added to `connect-src`, `img-src`, or `frame-src` requires review.

### Safe outbound requests and source URLs

- Each adapter owns a static HTTPS host allowlist. A public or admin request cannot supply an arbitrary fetch target.
- Parse URLs with a standards-compliant URL parser; reject credentials, fragments where irrelevant, non-HTTPS schemes, ambiguous encodings, IP literals, and non-standard ports unless specifically approved.
- Resolve DNS before connection and reject loopback, private, carrier-grade NAT, link-local, multicast, metadata-service, and otherwise non-public address ranges for both IPv4 and IPv6. Pin or re-check the resolved destination to prevent DNS rebinding.
- Disable redirects by default. An adapter that needs redirects allows a small fixed count and revalidates every destination against the same host and IP policy.
- Apply connection, headers, body, and total timeouts; cap response bytes before parsing; validate content type and schema; and limit decompression ratios.
- Source links displayed to users are independently validated, use `rel="noopener noreferrer"`, and are visibly attributed. Display does not imply the server will fetch the URL.
- Explorer links are built server-side from a chain registry and a validated chain/address tuple; external records cannot supply the link template.

### Webhooks, queues, and jobs

- Verify webhook signatures over the exact raw body using constant-time comparison. Verify timestamp within a narrow tolerance and store event IDs to reject replay before processing.
- Give every provider a distinct webhook secret and endpoint. Unknown event types are acknowledged safely or rejected according to provider requirements, but never routed to a generic command handler.
- Queue producers and consumers share versioned schemas. Jobs contain typed IDs and parameters, never executable code, SQL, filesystem paths, or arbitrary URLs.
- Consumers accept only allowlisted job names, enforce maximum payload size, acquire idempotency and concurrency locks, and cap retry counts with exponential backoff and jitter.
- Dead-letter payloads retain redacted diagnostic context and are never blindly replayed in bulk. Replay requires authorization, schema revalidation, and an audit record.
- Internal cron and job triggers use scoped, rotatable service credentials and network restrictions. A shared secret in a query string is prohibited.

### Rate limiting and denial-of-service controls

- Apply layered limits by IP, authenticated account, API key, route class, and provider cost. Return `429` with a bounded retry hint.
- Use low ceilings for authentication, exports, optimizer runs, broad historical queries, admin search, test notifications, and webhook failures.
- Enforce server-side maximums for rows, products compared, allocation variables, constraints, date span, chart points, and solver time. Reject infeasible or oversized work before database or solver execution.
- Cache public aggregates, use statement timeouts and indexed query shapes, paginate history, and move approved expensive exports to bounded background jobs.
- Circuit-break failing adapters and isolate worker concurrency per provider so one upstream cannot exhaust the queue.

### CSV and report safety

- Escape RFC 4180 fields and neutralize spreadsheet formulas. If the first non-whitespace character is `=`, `+`, `-`, `@`, tab, carriage return, or line feed, prefix the exported cell with a single quote.
- Never export secrets, internal notes, provider raw bodies, private admin fields, or authorization metadata through public/user exports.
- Use fixed column schemas, UTF-8, safe filenames, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, row limits, and audit records for admin exports.
- Reports identify source times, data status, methodology version, and disclosures. User-controlled text is encoded, not interpreted as HTML.

### Contract addresses and wallet analysis

- Validate chain identifiers against the chain registry and addresses with chain-appropriate parsers. EVM addresses are normalized/checksummed for display but stored with their canonical chain identity.
- Render addresses as text only. Do not accept HTML, JavaScript URLs, or external explorer bases from observation data.
- Wallet connection requests no approval and no signature merely to connect. The application never constructs or broadcasts executable transactions.
- Treat an address linked to an account as personal data even though balances are public. Do not log full linked addresses by default; use redacted or keyed-hash forms for operational correlation.
- Clearly mark unrecognized assets and incomplete RPC/indexer coverage.

### Logging and telemetry

- Use structured logs with timestamp, severity, service, environment, event name, correlation ID, and safe entity IDs.
- Redact authorization headers, cookies, magic links, passwords, tokens, connection strings, webhook signatures, provider bodies that may contain credentials, full email addresses, and user-linked wallet addresses.
- Error-monitoring payloads use the same redaction rules and disable automatic capture of request bodies and headers unless explicitly allowlisted.
- `OBSERVABILITY_MODE=platform` may send explicit worker error captures to the same redacted structured stdout/stderr stream only when the deployment host restricts log access. It must not bypass central redaction or add stack traces, request bodies, or headers. The default `external` mode requires a configured HTTPS Sentry or OTLP destination in production.
- Security and admin audit logs are access-controlled and tamper-evident or append-only. Application operators cannot silently edit history.

## Threat-control matrix

| Threat                                 | Preventive and detective controls                                                                                       | Required verification                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Authentication bypass                  | Mature auth provider, exact callback validation, state/nonce/PKCE, secure sessions, fail-closed middleware and handlers | Integration tests for forged/expired callbacks and unauthenticated protected routes              |
| Broken object-level authorization      | Owner-scoped queries and action-level server checks                                                                     | Tests attempt read/update/delete of every user-owned resource from a second user                 |
| Admin privilege escalation             | Authoritative server roles, MFA, recent-auth, second review, immutable audit log                                        | Tests modify client claims/cookies and call every admin endpoint as normal user                  |
| SQL injection                          | Strict schemas, parameterized ORM, reviewed bound raw SQL                                                               | Static analysis plus injection corpus against filters, sorts, imports, and admin search          |
| XSS and untrusted HTML                 | Contextual encoding, plain-text external content, CSP nonce, no arbitrary HTML/SVG                                      | Automated XSS corpus and CSP checks on tables, tooltips, reports, and admin previews             |
| CSRF                                   | SameSite cookies, origin checks, anti-CSRF token for cookie-auth mutations, no GET mutation                             | Cross-origin mutation tests and auth-callback tests                                              |
| SSRF and malicious source URLs         | Adapter host allowlists, DNS/IP validation, redirect revalidation, time/size caps                                       | Tests for metadata IPs, IPv6, numeric IPs, userinfo, redirect chains, and DNS rebinding behavior |
| Open redirect                          | Local-path or exact-host allowlist and server-generated callbacks                                                       | Tests with encoded schemes, protocol-relative URLs, backslashes, and nested return URLs          |
| Rate-limit abuse and expensive filters | Layered quotas, bounded inputs, query/solver timeouts, caching and cancellation                                         | Load tests for wide filters, history, optimizer, exports, and repeated auth attempts             |
| Credential exposure                    | Server-only secrets, scoped credentials, redaction, secret scanning, protected CI environments                          | Build scan for public-prefixed secrets; log/error/CI review; rotation drill                      |
| Dependency and build compromise        | Lockfile, automated audit, update review, pinned CI actions, minimal images, artifact provenance                        | PR and scheduled dependency scans; block exploitable critical/high findings                      |
| Webhook forgery and replay             | Raw-body signature, timestamp, event replay store, provider-specific secrets                                            | Invalid signature, stale timestamp, duplicate event, and oversized payload tests                 |
| Queue poisoning                        | Authenticated queue, strict job schemas, allowlisted names, bounded payloads, idempotency and DLQ review                | Fuzz invalid job versions/types and unauthorized producer tests                                  |
| CSV formula injection                  | Formula neutralization and fixed exports                                                                                | Tests for whitespace plus `=`, `+`, `-`, `@`, tab, CR, LF and quoted multiline cells             |
| Unsafe contract-address rendering      | Chain-aware validation and server-owned explorer registry                                                               | Tests for malformed addresses, chain mismatch, Unicode, HTML, and `javascript:` content          |
| Sensitive-data logging                 | Central redaction, safe event schemas, no automatic body/header capture                                                 | Automated canary-secret test across logs and error tracking                                      |
| Session fixation and brute force       | Session rotation, revocation, MFA, generic auth responses, layered throttles                                            | Session-ID rotation tests and distributed/passwordless replay abuse tests                        |

## Secret inventory and handling

No secret may use a client-exposed/public-prefixed variable. A public-prefixed variable is permitted only when its value is intentionally public and documented as such. Real values live in the deployment provider’s encrypted secret store; `.env.example` contains names and descriptions only.

| Secret class                                     | Canonical environment name(s)                         | Consumer                                 | Rotation expectation                                                                |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| PostgreSQL application and migration credentials | `DATABASE_URL`, `DIRECT_DATABASE_URL`                 | Web, worker, migration job               | Separate least-privilege users; rotate at least every 90 days and on access change  |
| Redis/queue credential                           | `REDIS_URL`                                           | Web and worker                           | TLS, scoped network access; rotate at least every 90 days                           |
| Auth session and provider credentials            | `AUTH_SECRET`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | Web/auth callbacks                       | Rotate session secret with overlap; provider credential at least every 90 days      |
| Field encryption key                             | `DATA_ENCRYPTION_KEY`                                 | Server-side sensitive fields, if enabled | Versioned envelope key; annual rotation or immediately on suspicion                 |
| Internal job and cron identity                   | `INTERNAL_JOB_TOKEN`, `CRON_SHARED_SECRET`            | Scheduler and internal endpoints         | Distinct scoped values; rotate at least every 90 days                               |
| Data, RPC, explorer, and price-provider keys     | Provider-specific server-only variables               | Worker adapters                          | Scope per provider/environment; rotate at least every 180 days or provider guidance |
| Email credential and webhook secret              | `EMAIL_API_KEY`, `EMAIL_WEBHOOK_SECRET`               | Worker/webhook receiver                  | Separate send/verify credentials; rotate at least every 180 days                    |
| Telegram bot and webhook credentials             | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`       | Worker/webhook receiver                  | Configure only when owner supplies them; rotate on operator/bot change              |
| Error-monitoring auth token                      | `ERROR_TRACKING_AUTH_TOKEN`                           | CI release upload/server                 | Write-minimal scope; rotate at least every 180 days                                 |
| Backup/export encryption credential              | Provider-managed or `BACKUP_ENCRYPTION_KEY`           | Backup service only                      | Keep outside app runtime; rotate under provider procedure                           |

Each secret has an owner, scope, creation date, last rotation date, next review, and revocation procedure in the operator secret register. Secrets are never sent in URLs, screenshots, support messages, telemetry, downloadable reports, or Git history. Local development uses distinct non-production credentials.

## Data classification and retention assumptions

These defaults minimize data while preserving operational and regulatory evidence. They require professional privacy and legal review before commercial scale and may be shortened by jurisdiction.

| Class                         | Examples                                                               | Default retention assumption                                                                      |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Public analytical data        | Published products, routes, source links, public methodology           | Retain while current; archive immutable historical versions for reproducibility                   |
| Account data                  | Email/provider ID, preferences, linked public addresses, saved objects | Until account deletion or purpose ends; purge active records within 30 days of a verified request |
| Notification data             | Destination identifiers, alert rules, delivery status                  | Rules until deleted; delivery metadata 180 days; avoid retaining provider message bodies          |
| Raw ingestion                 | Legally permitted provider response subset and provenance              | 30 days by default, then retain normalized observations; shorter where license requires           |
| Application logs              | Redacted request and job diagnostics                                   | 30 days online, up to 90 days restricted archive                                                  |
| Security and admin audit logs | Sign-in risk, role changes, publication and override history           | 2 years by default because integrity history is material                                          |
| Database backups              | Encrypted snapshots and point-in-time recovery logs                    | Rolling 35 days; deletion completes when the final containing backup expires                      |
| Dead-letter jobs              | Redacted failed payloads and diagnostics                               | 30 days or until resolved, whichever is sooner                                                    |

Do not collect government IDs, accreditation documents, private keys, seed phrases, payment-card data, or wallet signatures. Jurisdiction and investor classification are user-declared preferences unless a separate reviewed verification service is introduced.

Email addresses and Telegram chat identifiers used for alerts are normalized, authenticated-encrypted at rest, and represented in queries and logs only by a keyed hash or masked label. AES-GCM additional authenticated data binds ciphertext to its channel. A successful provider test marks a destination verified; ordinary external alert deliveries are suppressed until that test succeeds. Disabling a destination cancels its queued and retryable deliveries. Notification queue payloads contain only opaque delivery identifiers, so Redis and dead-letter storage never receive plaintext destinations.

Deletion must remove or irreversibly anonymize account-linked records, revoke sessions, disable alerts, remove notification destinations, and record a minimal non-identifying fulfillment receipt. Legally required security/admin audit facts may be retained with identity minimized and access restricted. Backup expiry is disclosed to the requester.

## Secure development and release gates

- Protect the main branch and production environment; require review for auth, authorization, admin, ingestion fetch, methodology, migration, workflow, and secret-handling changes.
- Install from the committed lockfile. Pin third-party CI actions to immutable commits and use minimal, non-root production images where containers are used.
- Run formatting, lint, type checking, unit/integration/E2E tests, production build, migration validation, secret scanning, dependency audit, and static security checks on pull requests.
- Resolve exploitable critical and high findings before release. A temporary exception requires owner, evidence, compensating controls, expiry, and security approval; it cannot be an ignored test or disabled rule.
- Generate software-bill-of-materials and provenance artifacts when supported. Keep build and runtime identities separate.
- Production smoke tests include unauthorized admin access, object ownership, secure headers, CSRF behavior, rate limits, redacted errors, health endpoints, and provider-degraded behavior.

## Incident response

### Severity

| Severity | Definition                                                                                                                          | Initial response target                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SEV-1    | Confirmed secret compromise, admin takeover, material data integrity breach, personal-data exposure, or widespread unsafe analytics | Page immediately; incident lead assigned within 15 minutes |
| SEV-2    | Credible attempted compromise, limited unauthorized access, major control failure, or sustained production outage                   | Incident lead within 30 minutes                            |
| SEV-3    | Contained vulnerability or degradation without known unauthorized access or material misinformation                                 | Triage within 4 business hours                             |
| SEV-4    | Low-risk hardening issue or informational report                                                                                    | Triage within 2 business days                              |

Targets are operational goals, not legal-notification deadlines.

### Procedure

1. **Detect and preserve.** Open a restricted incident record, assign incident commander and scribe, record UTC times, preserve relevant logs and snapshots, and avoid destructive cleanup.
2. **Classify.** Identify affected identities, data, routes, releases, credentials, providers, and time window. Treat analytical integrity compromise as a security incident even without personal-data exposure.
3. **Contain.** Revoke sessions or roles, disable affected adapters/endpoints, pause product publication or alerts, quarantine queue jobs, and rotate or revoke suspected credentials using a clean operator session.
4. **Eradicate.** Remove the entry point, patch and test the control, invalidate forged data, rebuild from trusted artifacts, and review adjacent credentials and systems.
5. **Recover.** Restore gradually, recalculate affected observations and scores from verified sources, run security and data-integrity smoke tests, and increase monitoring.
6. **Communicate.** Use approved status and legal/privacy channels. Do not speculate. Notify affected users and authorities according to counsel and applicable deadlines.
7. **Review.** Within five business days of recovery, document root cause, timeline, impact, detection gaps, actions, owners, and due dates. Track corrective work to closure.

Do not rotate a credential in a way that leaves the exposed value in CI logs, shell history, tickets, or chat. See `OPERATIONS_RUNBOOK.md` for executable incident, credential, rollback, product-pause, and deletion procedures.

## Vulnerability reporting

Report suspected vulnerabilities privately. Do not include secrets or personal data in a public issue.

1. Use the repository host’s private security-advisory feature until a monitored production security mailbox is configured.
2. At deployment, set and monitor `SECURITY_CONTACT_URL` and publish it in `/.well-known/security.txt` with an expiry date and the canonical policy URL.
3. Include affected URL/component, impact, reproduction steps, and proof-of-concept using non-production data.
4. The team acknowledges credible reports within two business days, provides a tracking reference, and coordinates disclosure after remediation.

Good-faith research that avoids privacy violations, service degradation, social engineering, fund movement, and data destruction will be handled through coordinated disclosure. This policy is not authorization to access data or systems beyond what is necessary to demonstrate the issue.

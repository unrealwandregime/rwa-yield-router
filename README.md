# RWA Yield Router

RWA Yield Router is a non-custodial analytics platform for comparing where on-chain cash and real-world-asset yield comes from, what comparative risks it carries, and how easily a user can exit.

It never takes custody, requests approvals or signing, constructs executable transactions, or presents variable returns as guaranteed. Product access and simulations are informational; users must verify eligibility directly with each issuer or protocol.

## Prerequisites

- Node.js 24.17.0 LTS
- pnpm 11.12.0
- PostgreSQL 18 and Redis 8, or Docker with Compose

## Local setup

1. Copy `.env.example` to `.env` and keep secrets out of Git.
2. Start dependencies with `docker compose up -d postgres redis`.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Apply migrations with `pnpm db:migrate`.
5. Seed canonical reference data with `pnpm db:seed`.
6. Validate and import the sourced production catalog with `pnpm data:validate` and `pnpm db:catalog-import`.
7. Verify database invariants with `pnpm db:verify`.
8. Start web and worker processes with `pnpm dev`.
9. Open `http://localhost:3000`.

If Supabase Auth is not configured, public research pages remain available and protected account/admin actions fail closed. The wallet-analysis page is explicitly disabled unless at least one supported read-only RPC is configured.

## Commands

| Command                                                                             | Purpose                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                                                          | Run web and worker in development.                                                                     |
| `pnpm format` / `pnpm format:check`                                                 | Write or check repository formatting.                                                                  |
| `pnpm lint`                                                                         | Run lint rules across the workspace.                                                                   |
| `pnpm typecheck`                                                                    | Run strict TypeScript checks.                                                                          |
| `pnpm test`                                                                         | Run unit tests.                                                                                        |
| `pnpm test:integration`                                                             | Run isolated integration tests.                                                                        |
| `pnpm test:e2e`                                                                     | Run Playwright end-to-end tests.                                                                       |
| `pnpm test:a11y`                                                                    | Run the tagged accessibility suite.                                                                    |
| `pnpm build`                                                                        | Create production builds.                                                                              |
| `pnpm validate`                                                                     | Run the release-quality local gate.                                                                    |
| `pnpm db:generate`                                                                  | Generate a reviewed Drizzle migration.                                                                 |
| `pnpm db:migrate`                                                                   | Apply checked migrations.                                                                              |
| `pnpm db:seed`                                                                      | Seed canonical categories, assets, roles, yield sources, and methodology metadata; never live metrics. |
| `pnpm db:catalog-import`                                                            | Idempotently import the reviewed 60-record production catalog with provenance.                         |
| `pnpm db:grant-admin -- --email=admin@example.com --reason="Initial audited grant"` | Grant the first administrator role after that user has signed in once.                                 |
| `pnpm db:verify`                                                                    | Check migration and schema invariants.                                                                 |
| `pnpm data:validate`                                                                | Validate the sourced import catalog.                                                                   |
| `pnpm smoke`                                                                        | Exercise deployed health and public routes.                                                            |

## Production containers

Build both immutable service images from the repository root. The Supabase anon key is intentionally browser-visible; do not pass any server secret as a build argument.

```sh
docker build -f apps/web/Dockerfile \
  --build-arg APP_URL=https://router.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-key \
  -t rwa-yield-router-web:local .
docker build -f apps/worker/Dockerfile -t rwa-yield-router-worker:local .
```

The web image starts `node apps/web/server.js` on port 3000. The worker image starts `node dist/main.js` on port 3001 and requires `DATABASE_URL` plus `REDIS_URL`. Both images run as the unprivileged `node` user and expose dependency-aware `/health/ready` checks. Supply runtime configuration through the deployment platform; never copy `.env` into an image.

The worker image also contains the compiled database migration and bootstrap tools used by one-off release jobs. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the exact commands and required ordering.

## Documentation

Repository rules and product decisions live in [AGENTS.md](./AGENTS.md), [REQUIREMENTS.md](./REQUIREMENTS.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [DATA_SOURCES.md](./DATA_SOURCES.md), [RISK_METHODOLOGY.md](./RISK_METHODOLOGY.md), [SECURITY.md](./SECURITY.md), [TEST_PLAN.md](./TEST_PLAN.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

Legal pages shipped in the application are working product copy, but require professional legal review before commercial scale.

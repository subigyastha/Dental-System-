# Environment and Local Development Guide

| Field | Value |
| --- | --- |
| Status | Production-target developer guide |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |

## 1. Prerequisites

- A supported Node.js LTS version, pinned in repository tooling before production release.
- npm compatible with the repository lockfile.
- PostgreSQL reachable through `DATABASE_URL`.
- Redis for production-equivalent cache, jobs, and distributed invalidation testing.
- Provider sandbox credentials only when testing messaging or payment adapters; never share production secrets in local files, source control, screenshots, or logs.

## 2. Workspace structure

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js user interface |
| `apps/api` | NestJS business/data API |
| `prisma` | Shared PostgreSQL schema, migrations, and seed script |
| `docs` | Product and operational specifications |

Run all workspace commands from the repository root.

## 3. Required configuration

Use a local `.env.local` file for developer overrides and never commit it. The Nest API currently reads root `.env.local` and `.env`; the release target validates configuration at startup and fails fast on missing/unsafe production values.

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Application PostgreSQL connection | Runtime database connection; use least-privilege credentials. |
| `DIRECT_URL` | Yes for migrations | Migration PostgreSQL connection | Use the Supabase direct URL when IPv6 is available. On IPv4-only networks use the Supavisor Session Mode pooler on port 5432; do not use Transaction Mode port 6543 for migrations. |
| `SUPABASE_POOL_MODE` | No | Runtime Supabase pool behavior | A supplied 6543 URL defaults to Transaction Mode with Prisma PgBouncer settings. Set `session` only where the pooler 5432 endpoint is reliably reachable. This never changes `DIRECT_URL`. |
| `PRISMA_CONNECTION_LIMIT` | Recommended | Per-process Prisma pool size | Defaults to 5 for the persistent Nest process and is validated from 1–20. Divide the available database pool across all deployed API instances. |
| `AUTH_SECRET` | Yes | Session/token signing secret | Long, unique secret from a secret manager; no development fallback in production. |
| `CORS_ORIGINS` | Production | Approved browser origins | Comma-separated HTTPS origins. Startup fails if omitted in production. |
| `SESSION_TTL_SECONDS` | Recommended | Absolute server-session lifetime | Defaults to 8 hours. |
| `SESSION_IDLE_TIMEOUT_SECONDS` | Recommended | Inactive server-session timeout | Defaults to 30 minutes. |
| `SESSION_TOUCH_INTERVAL_SECONDS` | Recommended | Session activity persistence interval | Defaults to 5 minutes and is capped at one-third of the idle timeout, preventing a database write on every protected read. |
| `API_PORT` | Local API | Nest listener port | Current default is `4000`; production is platform-configured. |
| `NEXT_PUBLIC_API_URL` | Web | Nest API base URL | Must point only to the approved API origin. |
| `REDIS_URL` | Production/staging | Shared cache, queues, invalidation | Required once distributed scheduling/cache features ship. |
| `APP_ENV` | Yes | Environment identity | `development`, `test`, `staging`, or `production`. |
| `LOG_LEVEL` | Recommended | Structured-log verbosity | Do not enable sensitive payload logging. |
| `ERROR_TRACKING_DSN` | Production/staging | Error reporting destination | Use environment-separated projects. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Production/staging | Trace/metric export | Optional only until observability rollout is complete. |
| `SMS_PROVIDER_*` | Feature-specific | SMS adapter configuration | Server-side secrets; enabled only through Super Admin feature flag. |
| `WHATSAPP_PROVIDER_*` | Feature-specific | WhatsApp adapter configuration | Server-side secrets; enabled only through Super Admin feature flag. |
| `PAYMENT_PROVIDER_*` | Feature-specific | Fonepay/other provider credentials and webhook secrets | Server-side only; never exposed with `NEXT_PUBLIC_`. |

All provider credentials and webhook secrets are server-side secrets. They must never be supplied to browser code, stored in database plaintext, or returned through APIs.

## 4. First-time setup

1. Install dependencies: `npm install`.
2. Create `.env.local` using the approved secret-management/local-development process and supply database/auth variables.
3. Generate Prisma client if post-install did not do so: `npx prisma generate`.
4. Apply local migrations: `npm run db:migrate:dev`.
5. Seed only a disposable local database, with a unique local passphrase: `$env:ALLOW_DEMO_SEED="true"; $env:DEMO_SEED_PASSWORD="a-unique-15-character-minimum-passphrase"; npm.cmd run db:seed`.
6. Start API: `npm run dev:api`.
7. Start web in a second terminal: `npm run dev:web`.
8. Verify API health/readiness after health endpoints are implemented, sign in with approved local test data, and confirm the web calls Nest—not Prisma directly.

Seed data is for local/demo use only. It is not a fallback when an API or database is unavailable. It is deliberately opt-in and never contains a committed default password. Do not reuse its passphrase outside the disposable database.

## 5. Common commands

| Goal | Command |
| --- | --- |
| Run web development server | `npm run dev:web` |
| Run API development server | `npm run dev:api` |
| Build web | `npm run build` |
| Build API | `npm run build:api` |
| Typecheck both workspaces | `npm run typecheck` |
| Lint web | `npm run lint` |
| Run calendar tests | `npm run test:calendar` |
| Create local migration | `npm run db:migrate:dev` |
| Apply released migrations | `npm run db:migrate:deploy` |
| Check migration state | `npm run db:migrate:status` |
| Rehearse checked-in migrations safely | `npm run db:migrate:rehearse` |
| Seed local database | `npm run db:seed` |

## 6. Migration and data safety rules

- Use Prisma migrations for every schema change; do not use `db push` against staging or production.
- Treat production migrations as reviewed code. Use expand/contract migration sequencing for backwards-compatible web/API deployments.
- Back up and test restore before destructive or irreversible changes.
- Client, Record, invoice, payment, audit, role, and inventory-history changes require the relevant governance specification and an ADR before implementation.
- Use separate databases, credentials, secrets, provider sandboxes, and analytics datasets per environment.

### 6.1 Migration rehearsal checklist

Run `npm run db:migrate:rehearse` against a disposable local database before requesting review of a migration. The command performs `prisma migrate status`, `prisma migrate deploy`, and a final status check; it never uses `prisma db push`.

The command refuses `APP_ENV` values for staging or production. It allows only loopback-local PostgreSQL URLs, or an explicitly named test database when `APP_ENV=test`. It prints redacted, artifact-friendly `MIGRATION_REHEARSAL` lines and a compact final JSON report. To include non-authenticated API health guidance after the API is running, use:

```powershell
npm run db:migrate:rehearse -- -SmokeApiBaseUrl http://localhost:4000
```

Before declaring the rehearsal successful, retain the console report and confirm:

1. `status-before`, `deploy`, and `status-after` are recorded; `status-after` exits with `0`.
2. The reported database safety class is `loopback-local` or `explicit-test`.
3. The generated Prisma client, relevant application build, and affected test suite also pass.
4. For a change that needs data backfill, the migration is additive first and the backfill is separately observable and repeatable.

### 6.2 Failure and forward repair

On a rehearsal, staging, or production migration failure, stop dependent deployment. Preserve the redacted rehearsal output, migration name, release version, and database error details in the restricted incident/release record. Do not use `db push`, `migrate reset`, a destructive schema rollback, or manually delete entries from Prisma's migration table.

Prefer a reviewed forward repair: identify the last successfully applied migration, make the application compatible with that state, add a new corrective migration or idempotent backfill, rehearse it on a restored copy, and redeploy. Restore or point-in-time recovery requires the incident owner’s explicit decision and the runbook’s backup/restore procedure. Use `prisma migrate resolve` only with a reviewed recovery plan that documents why the migration state is safe.

## 7. Local troubleshooting

| Symptom | Safe response |
| --- | --- |
| Prisma cannot connect | Verify non-secret host/database details and reachability; do not paste credentials into logs. |
| Migrations fail | Run migration status; never force/reset shared data without an approved recovery plan. |
| Web cannot reach API | Verify API health and configured origin; do not add direct Prisma fallback. |
| Authentication fails | Sign in again and verify secret configuration and active role assignment. |
| Schedule appears stale | Retry authorized API read and inspect invalidation telemetry; do not trust a cached slot to book. |
| Messaging/payment callback fails | Verify Super Admin feature flag, sandbox credential, signature, and callback URL using redacted logs. |

## 8. Development acceptance checklist

Before opening a pull request, run typecheck, relevant unit/integration tests, lint, and builds. Test both an allowed and denied organization/location action. Verify no client-terminology regressions, direct web Prisma path, secret, or real client data in fixtures, logs, or commits.
The web application deliberately writes development artifacts to
`apps/web/.next-dev` and production builds to `apps/web/.next`. This prevents a
running `next dev` process and `next build` from replacing each other's chunks,
which otherwise presents as a persistent HTTP 500 with `Cannot find module
'./<chunk>.js'`. Restart the web development server once after upgrading from a
checkout that predates this isolation.

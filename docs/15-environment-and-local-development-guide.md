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
| `DIRECT_URL` | Yes for migrations | Direct PostgreSQL connection | Used by Prisma migration/deploy tooling, not normal pooled runtime traffic. |
| `AUTH_SECRET` | Yes | Session/token signing secret | Long, unique secret from a secret manager; no development fallback in production. |
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
5. Seed only a disposable local database: `npm run db:seed`.
6. Start API: `npm run dev:api`.
7. Start web in a second terminal: `npm run dev:web`.
8. Verify API health/readiness after health endpoints are implemented, sign in with approved local test data, and confirm the web calls Nest—not Prisma directly.

Seed data is for local/demo use only. It is not a fallback when an API or database is unavailable.

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
| Seed local database | `npm run db:seed` |

## 6. Migration and data safety rules

- Use Prisma migrations for every schema change; do not use `db push` against staging or production.
- Treat production migrations as reviewed code. Use expand/contract migration sequencing for backwards-compatible web/API deployments.
- Back up and test restore before destructive or irreversible changes.
- Client, Record, invoice, payment, audit, role, and inventory-history changes require the relevant governance specification and an ADR before implementation.
- Use separate databases, credentials, secrets, provider sandboxes, and analytics datasets per environment.

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

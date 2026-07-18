# Deployment, Security, and Observability Runbook

| Field | Value |
| --- | --- |
| Status | Normative production runbook |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |

## 1. Deployment architecture

ClinicFlow deploys as independently scalable services:

- **Web:** Next.js application for UI and rendering only.
- **API:** NestJS service, the only business/data authority.
- **Worker:** background service for notification delivery, payment webhook processing/reconciliation, outbox processing, and scheduled work.
- **PostgreSQL:** managed authoritative database.
- **Redis:** managed shared cache, distributed invalidation, and job queue support.
- **Object/secret services:** approved managed providers for encrypted backups, secret management, logs, metrics, and error tracking.

Environments are separate: development, test, staging, and production. They use isolated databases, Redis instances/namespaces, secrets, provider credentials, callback URLs, and analytics datasets. Production data must never be copied into lower environments without approved de-identification.

## 2. Release process

1. Merge reviewed, tested, backwards-compatible code.
2. Build immutable web/API/worker artifacts and publish their version identifiers.
3. Apply reviewed `prisma migrate deploy` once through a controlled migration job before dependent application rollout.
4. Deploy worker/API, verify readiness, then deploy web using rolling or canary release controls.
5. Run smoke tests: authenticated API, tenant denial, provider booking conflict, billing/payment state, feature-flag behavior, and enabled integration callback verification.
6. Monitor error/latency/job dashboards during the release window and document outcome.

Schema changes use expand/contract sequencing. An application release must remain compatible with the immediately preceding schema/application version until the migration is fully rolled out. Do not run `prisma db push` in staging or production.

## 3. Secret and integration management

- Store `AUTH_SECRET`, database credentials, Redis URL, API keys, Fonepay/other payment credentials, SMS credentials, WhatsApp credentials, and webhook signing secrets only in the environment secret manager.
- Rotate secrets on suspected exposure, personnel change, or provider requirement; record rotation without exposing secret values.
- Provider configuration and message/payment enablement require Super Admin feature-flag approval. A global flag can enable/disable each integration; clinic provisioning remains separately authorized and audited.
- The browser never receives provider secret keys or verifies payment/provider webhooks.
- Webhooks are HTTPS-only, signature-verified, replay/idempotency-protected, rate-limited, and processed through the Nest/worker boundary.

## 4. Security baseline

- Enforce HTTPS, HSTS, secure cookies, `HttpOnly`, `SameSite`, CSRF protection where cookie sessions are used, secure CORS allowlists, and standard security headers.
- Authenticate every non-public API endpoint. Central Nest guards derive organization/location scope from the session and enforce action-level authorization.
- Super Admin is platform-scoped, sees aggregate/de-identified metrics by default, and receives time-bound, reasoned, audited, read-only support access only when approved.
- Encrypt transport and managed database/backups. Restrict database network access to application/migration paths; use least-privilege service identities.
- Do not log passwords, sessions, medical notes, chart JSON, payment credentials, full provider callback payloads, or unnecessary client identifiers.
- Perform dependency scanning, secret scanning, SAST, access review, and penetration/security testing before launch and at a defined cadence.
- Critical information deletion follows two steps: archive first; then an Owner may permanently delete from the archive only after explicit confirmation. Audit/financial/legal-retention constraints can prohibit the final step.

## 5. Backup, restore, and rollback

- Automate encrypted database backups with documented retention and tested point-in-time recovery where supported.
- Rehearse restore into an isolated environment at least quarterly and after material database changes; record recovery time/objective evidence.
- Back up configuration required to restore feature flags, integration settings, and migration history without copying secrets into source control.
- Prefer application rollback only when schema compatibility remains safe. For data migrations, use a reviewed forward-fix or restore plan; never run a destructive rollback without an explicit incident decision.

## 6. Logging, metrics, traces, and audit

Every API request, worker job, integration callback, and material mutation receives a correlation ID propagated across logs, traces, domain events, and user-visible error/support references.

| Signal | Required content |
| --- | --- |
| Structured logs | timestamp, service, environment, release, request/job/correlation ID, outcome, latency, sanitized tenant/scope reference |
| Metrics | request count/error rate/latency, database/Redis health, queue depth/age/failure, cache effectiveness, booking conflicts, provider webhook verification/reconciliation failures |
| Traces | web/API/worker/database/cache/provider boundaries, sampled without sensitive payloads |
| Audit logs | actor, action, target, time, authorization context, reason/confirmation where required, before/after or event reference |
| Product analytics | aggregate/de-identified organization/user/feature activity only; never clinical note/chart content |

## 7. Health checks and alerts

Provide protected/appropriate endpoints:

- `/health/live`: process is running; no dependency call.
- `/health/ready`: API can serve safely, including required database/cache dependencies.
- worker health: queue connectivity and current processing ability.

Alert the on-call owner for sustained API 5xx, readiness failure, database/Redis outage, migration failure, p95 latency breach, queue backlog, failed/replayed webhooks, payment reconciliation exceptions, notification failure spikes, backup failure, unusual authorization denials, and feature-flag changes.

## 8. Incident response

1. Triage severity, customer/tenant impact, and whether clinical, financial, or security data is affected.
2. Contain safely: disable a Super Admin-controlled feature flag, pause worker queues, revoke credentials, or restrict traffic as appropriate.
3. Preserve logs/audit evidence and communicate through the approved incident channel.
4. Restore service using the least-destructive approved action; verify booking/payment consistency after recovery.
5. Notify affected clinics and regulators where required by policy/law.
6. Complete a blameless post-incident review with timeline, corrective actions, owner, and ADR if a design decision changes.

## 9. Current gaps and launch gates

The repository currently lacks deployment manifests/CI, managed-worker integration, shared Redis cache, secure cookie sessions, CORS restrictions, rate limits, structured logging, error tracking, telemetry, backup/restore automation, health/readiness endpoints, and a documented incident process. These are launch blockers, not optional improvements.

Production launch requires evidence for every section above, a successful staging disaster-recovery rehearsal, and a named on-call/incident owner.

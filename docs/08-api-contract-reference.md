# API Contract Reference

**Status:** normative target contract; current inventory is derived from `apps/api/src/modules` on 2026-07-18.
**Base URL:** `/api/v1` in production. The existing server prefix is `/api` and is therefore a pre-v1 compatibility surface to migrate, not the permanent contract.

## 1. Contract-wide rules

- **Authority:** NestJS is the only operational API and business authority. Next.js may render UI/SSR, but must call this API; browser/server UI code must not import Prisma or read PostgreSQL directly. Provider callbacks enter dedicated API webhook routes only.
- **Media type and casing:** JSON (`application/json`), UTF-8, lower camelCase fields. IDs are opaque strings. Decimal money is sent as decimal strings (`"1250.00"`) in v1 responses and requests where precision matters.
- **Dates:** all timestamps are ISO-8601 UTC strings. Request dates use fields such as `startsAtIso`. `calendar=AD|BS` changes presentation-only labels; it never changes stored/request canonical instants. Default is AD.
- **Tenant scope:** identity/session determines organization and permitted location scopes. Client-provided `organizationId` is ignored or rejected for standard tenant routes. A SuperAdmin must use explicitly named platform/support routes; it never acquires implicit clinic access.
- **Authentication:** target uses short-lived secure, HttpOnly, SameSite cookies (with CSRF protection for cookie-authenticated writes) or a documented service token for integrations. Authorization is resolved server-side for every request from active multi-role/location assignments. Existing Bearer/localStorage-token behavior is transitional only.
- **Concurrency/idempotency:** every `POST`, state transition, archive/delete confirmation, and payment/provider operation accepts `Idempotency-Key` (UUID) and returns the same result for a repeated key/body. Mutations return `ETag`; clients send `If-Match` for mutable drafts/configurations. Conflicting versions return `409`.
- **Pagination:** collection endpoints use opaque cursor pagination: `?limit=50&cursor=...`; `limit` is 1–100 (default 50). Response `{ data, page: { nextCursor, hasMore } }`. Calendar summary endpoints may use bounded date ranges instead.
- **Envelope/errors:** successful single response `{ data, meta? }`; errors use `application/problem+json` with `{ type, title, status, code, detail, traceId, fieldErrors? }`. Never expose secrets, hashes, PII, or provider payloads in errors.

### Required error codes

| Status | Examples |
|---|---|
| 400 | `VALIDATION_ERROR`, malformed ISO date, unsupported calendar |
| 401 / 403 | `UNAUTHENTICATED`, `FORBIDDEN`, `LOCATION_SCOPE_DENIED` |
| 404 | `NOT_FOUND` (do not reveal cross-tenant existence) |
| 409 | `VERSION_CONFLICT`, `PROVIDER_SCHEDULE_CONFLICT`, `DUPLICATE_CLIENT_POSSIBLE`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED` |
| 410 / 423 | `ARCHIVED`, `DELETION_BLOCKED` |
| 422 | `BUSINESS_RULE_VIOLATION`, `PAYMENT_AMOUNT_EXCEEDS_BALANCE` |
| 429 / 503 | `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE` |

## 2. Current route inventory and v1 disposition

Existing routes are below `/api/<route>` and most accept `Authorization` manually. They are implementation inventory, not a statement that their security/lifecycle behavior is sufficient. Replace legacy `customers` and `visit-reports` surface with `clients` and `records` in v1.

| Current endpoint(s) | Current purpose | v1 direction |
|---|---|---|
| `POST /auth/login`, `GET /auth/me` | Login and session lookup. | `POST /v1/auth/sessions`, `GET /v1/auth/session`, `DELETE /v1/auth/session`; cookie session, rotation/CSRF/logout. |
| `GET /system/status` | Database status/count. | `/v1/health/live`, `/ready` protected as appropriate; do not reveal tenant counts publicly. |
| `GET /operational-data` | Oversized bootstrap payload. | Split into explicit dashboard/schedule read models with cache metadata. |
| `GET/POST/PATCH/DELETE /customers`, `POST /customers/match`, `/resolve-for-appointment`, `/:id/merge` | Current client CRUD/match/merge. | `/v1/clients`; archive/delete-request lifecycle; atomic client code; shared phones allowed. |
| `GET/POST/DELETE /customers/:id/visit-reports...` | Current mutable reports. | `/v1/clients/:clientId/records` and `/v1/records/:id`; draft/sign/amend, no destructive signed changes. |
| `GET/POST/PATCH/DELETE /appointments`, `PATCH /:id/status`, day/week summaries | Booking CRUD/status/calendar. | `/v1/appointments`, transition endpoints, schedule summaries; provider-only conflict control. |
| `/providers`, schedules, slots, availability/blocks | Providers and schedule configuration. | `/v1/providers` and scoped availability/block routes; do not expose chair/resource booking contract. |
| `/staff` CRUD/password/restore | Single-role staff management. | `/v1/users`, memberships and role-assignment endpoints; archive/restore rather than delete. |
| `/billing/invoices` and nested payments | Invoice/payment CRUD. | `/v1/finance/*`; append-only completed payments, corrections/provider intents/webhooks. |
| `PATCH /followups/:id` | Update task. | `/v1/follow-up-tasks` standard CRUD/transition, tenant scope and audit. |
| `POST /communications` | Log a communication. | `/v1/communications`; delivery belongs in notifications/outbox. |
| `PATCH /organizations/:id` | Update tenant. | `/v1/organization`; Owner/Admin-only selected settings. |

## 3. Target v1 module inventory

`R` means authenticated read; `W` means write; permissions are additionally constrained by the Authorization and Permission Matrix and location scope.

| Module / representative routes | Contract / permission expectation |
|---|---|
| Auth: `POST /auth/sessions`, `GET/DELETE /auth/session`, `POST /auth/password-resets` | Login/session lifecycle. Responses omit password hash and role internals. Rate limit and audit. |
| Platform: `GET /platform/metrics`, `GET/PATCH /platform/features/:key`, `GET /platform/organizations` | SuperAdmin only. Aggregated/de-identified metrics by default; platform feature flags are audited. Support data access requires separate time-limited, reasoned grant. |
| Organization/location: `GET/PATCH /organization`, `GET/POST/PATCH /locations` | Owner/Admin manage configuration; all members R within scope. `primaryCalendar` defaults AD; permissible BS display config is explicit. |
| Users & roles: `GET/POST/PATCH /users`, `POST /users/:id/archive`, `POST /users/:id/restore`, `GET/POST/DELETE /users/:id/role-assignments` | Owner/Admin (and scoped delegation only when explicitly allowed). `roleAssignments[]` supports multiple roles and nullable organization-wide / named location scopes. Owner/Admin capabilities cover all clinic roles. |
| Clients: `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/archive`, `POST /clients/:id/delete-requests`, `POST /client-deletion-requests/:id/confirm`, `POST /clients/:id/merge`, `POST /clients/matches` | Clinic operators R/W by authorization. Client identifiers are immutable/aliased; common phones allowed. Only Owner confirms final deletion after archive and blockers check. |
| Records & chart: `GET/POST /clients/:id/records`, `GET /records/:id`, `PATCH /records/:id` (draft only), `POST /records/:id/sign`, `POST /records/:id/amendments`, `GET /clients/:id/dental-chart/revisions` | Providers may see all clinic client records in phase one. Draft authors may edit permitted fields; signed Records/chart revisions are immutable. Signing/amending emits audit/workflow events. |
| Services/providers: `GET/POST/PATCH /services`, `GET/POST/PATCH /providers`, `GET/PUT /providers/:id/availability`, `POST /providers/:id/blocks` | Clinic administration configures; authorized operations staff can read. Service/provider ownership must match tenant. |
| Scheduling: `GET /appointments`, `GET /schedule/day`, `GET /schedule/week`, `POST /appointments`, `PATCH /appointments/:id` (allowed preterminal details), `POST /appointments/:id/transitions`, `POST /appointments/:id/archive` | Provider-only appointments: body requires clientId, providerId, serviceIds, startsAtIso, durationMinutes, bufferMinutes, priority; location optional. No `chair`/`resourceId` public field. Transaction must hard-fail provider conflict; no overbooking. Reschedule creates linked appointment/history, not silent overwrite. |
| Follow-up: `GET/POST /follow-up-tasks`, `PATCH /follow-up-tasks/:id`, `POST /follow-up-tasks/:id/transitions` | Authorized staff; status transition validation and audit. |
| Notifications/communications: `GET /notifications`, `POST /notifications` (internal enqueue), `GET/POST /communications` | Enqueue validates SuperAdmin platform flag **and** clinic channel configuration. Phase-one provider adapters: WhatsApp and SMS. Delivery workers, not UI requests, send messages. |
| Finance invoices: `GET/POST /finance/invoices`, `GET/PATCH /finance/invoices/:id` (draft only), `POST /finance/invoices/:id/issue`, `POST /finance/invoices/:id/void`, `POST /finance/invoices/:id/cancel` | Finance role and permitted Receptionist actions. Issuance freezes lines/tax/discount totals. Manager read-only by default. No inventory endpoint is invoked by invoice operations. |
| Finance payments: `POST /finance/invoices/:id/payments`, `GET /finance/payments/:id`, `POST /finance/payments/:id/refunds`, `/reversals`, `/voids`; `POST /finance/payment-intents`; `POST /integrations/payments/:provider/webhooks` | Receptionist may record permitted payment records against issued invoices. Completed payments are immutable. Corrections are linked new events; finance initiation and configurable Owner/Admin approval threshold apply. Webhooks signature-validate and use idempotency. Fonepay begins sandbox only. |
| Inventory: `GET/POST /inventory/items`, `GET/POST /inventory/stock-movements`, `POST /inventory/adjustments`, `POST /records/:id/consumption` | Distinct permission/module and immutable movements. No automatic finance/COGS/invoice mutation. |
| Audit/read models: `GET /audit-events`, `GET /dashboard`, `GET /schedule-snapshots` | Audited administrator access and cache metadata (`generatedAt`, `version`, `staleAt`). Read models cannot bypass data authority. |

## 4. Representative request/response contracts

### Create a client

`POST /api/v1/clients` with `Idempotency-Key`:

```json
{
  "fullName": "Asha Shrestha",
  "phone": "+9779812345678",
  "email": "asha@example.com",
  "dateOfBirthIso": "1990-02-05T00:00:00.000Z",
  "riskLabel": "Routine"
}
```

The server normalizes search fields, runs duplicate matching, atomically assigns `clientCode`, and returns `201 { "data": { "id", "clientCode", "fullName", "..." } }`. A match warning is presented as `409 DUPLICATE_CLIENT_POSSIBLE` with minimum necessary candidate fields unless the caller explicitly confirms creation through a documented resolution flow. A phone is never globally or tenant-unique.

### Create an appointment

```json
{
  "clientId": "cl...",
  "providerId": "pr...",
  "serviceIds": ["sv..."],
  "startsAtIso": "2026-07-20T04:15:00.000Z",
  "durationMinutes": 45,
  "bufferMinutes": 10,
  "priority": "Normal",
  "notes": "First consultation"
}
```

The server derives/validates end time, organization/location membership, active provider availability, blocks, lead range and provider conflicts in one transaction. A conflict returns `409 PROVIDER_SCHEDULE_CONFLICT`; never accept `resourceId` or chair as a phase-one constraint. Response includes `etag`, status, UTC times, display date metadata when requested, and relevant linked summaries.

### Record payment and provider payment intent

`POST /finance/invoices/{invoiceId}/payments` records a permitted manual payment with `amount`, `method`, `paidAtIso`, optional `referenceNumber`, and notes. It requires an issued invoice and cannot exceed permitted balance. A successful completed payment is immutable.

`POST /finance/payment-intents` uses `{ invoiceId, providerKey: "fonepay", returnUrl }`; the server selects a clinic-approved active provider account and returns only safe client action fields. The provider webhook is never trusted from browser return state: it is signature-verified, stored/replayed idempotently, reconciled, then emits a payment event.

## 5. Validation, transition, and compatibility rules

- Global Nest validation remains `transform`, `whitelist`, and `forbidNonWhitelisted`; DTOs define required fields, enums, positive numeric values, arrays and ISO dates. Business validation belongs to services/transactions, not controllers.
- IDs in URL/body are checked for active tenant and location membership. Never accept actor, role, financial total, signed state, provider-delivery status, or organization as client-controlled authority.
- `DELETE` is not the contract for critical data. Archive endpoints require reason; final Owner confirmation uses a deletion request + confirmation challenge and may return `423 DELETION_BLOCKED`. Signed Records, chart revisions and completed payments have no delete route.
- State changes use named transition endpoints, expected current state/version, actor attribution, audit event and domain/outbox event in the same transaction. Generic `PATCH status` is legacy only.
- v1 changes are additive/backward compatible within the major version. Deprecate `/api` legacy endpoints with `Deprecation` and `Sunset` headers, publish migration mapping, and retain compatibility adapters only for a documented window. Never silently rename `customer` payloads; adapters translate them to `client` at the boundary.

## 6. Explicitly forbidden flows

1. Browser or Next.js server route directly querying Prisma/PostgreSQL for clinic operational data.
2. Trusting `organizationId`, role, location scope, invoice total, payment completion, or provider webhook outcome sent by a client.
3. A provider callback writing a payment without signature verification, tenant-account match, stored event, and idempotency control.
4. A direct `DELETE` or update of signed clinical content, chart revisions, completed payments, or audit events.
5. Scheduling that checks availability outside the insert/update transaction, or that treats chair/resource availability as phase-one booking authority.
6. Sending SMS/WhatsApp unless both the SuperAdmin platform flag and clinic-specific provider/channel configuration are enabled.

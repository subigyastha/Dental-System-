# Billing and Payment Lifecycle

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Status | Normative release specification |
| Currency baseline | NPR, two decimal places |

## 1. Purpose and boundary

This specification defines invoices, invoice line items, payments, refunds, reversals, provider integrations, reconciliation, and financial audit controls. Billing is financially independent from inventory: inventory movements do not create invoice lines, payments, journal entries, costs of goods sold, or stock valuation automatically. NestJS billing services are the sole financial authority.

Amounts are stored and calculated in NPR with exactly two decimal places. Rounding is decimal (never binary floating point), applied per documented rule and retained in the invoice snapshot. An organization may configure tax rules, tax registration information, default rates, and discount policy. Those configuration values are versioned; they are not retroactively applied to issued invoices.

## 2. Roles and separation of duties

Users may have multiple roles. Owner and Admin have all organization roles, subject to the explicit-confirmation and audit safeguards below. A dedicated Finance role must be assignable independently of other roles and may be location-scoped where the authorization model allows it.

| Action | Owner/Admin | Finance | Receptionist | Provider/Assistant |
| --- | --- | --- | --- | --- |
| Create/edit a draft invoice | Yes | Yes | Yes | No, unless separately granted |
| Issue invoice | Yes | Yes | No | No |
| Record a payment on an issued invoice | Yes | Yes | Yes | No |
| Edit/delete completed payment | Never; use correction event | Never | Never | Never |
| Initiate refund, void, or reversal | Yes | Yes | No | No |
| Approve a configured high-value correction | Yes | No | No | No |
| Configure tax/payment providers | Yes | No | No | No |
| Reconcile provider settlements | Yes | Yes | No | No |

Receptionists may record a payment only against a valid issued/partially paid invoice, within the remaining balance, with method, amount, time, and reference as applicable. They may not issue invoices, change issued invoice terms, edit completed payments, initiate refunds, voids, reversals, provider configuration, reconciliation, or financial reporting beyond their permitted operational view.

## 3. Invoice data and calculation rules

An invoice belongs to exactly one organization and one Client; it may link to one appointment/Record context but remains a financial document in its own right. It contains an organization-unique sequential invoice number, status, client snapshot identifiers, issue/due dates, notes, subtotal, discount, tax, total, paid amount, balance, and ordered line-item snapshots.

Each line item includes description, quantity, unit price, discount amount/rule, tax amount/rule, line total, source service where applicable, and immutable snapshot metadata. Formulae are:

```text
line base      = quantity × unit price
line total     = line base − permitted line discount + line tax
subtotal       = sum(line base)
discount total = sum(line discounts) + permitted invoice discount
tax total      = sum(line taxes)
invoice total  = subtotal − discount total + tax total
balance        = invoice total − completed valid receipts + approved financial corrections
```

Negative quantity, price, discount, tax, line total, total, and balance values are rejected unless an explicit future credit-note design permits them. Discounts cannot exceed their applicable base. A posted payment cannot exceed the collectible balance. The API recalculates every derived amount server-side in a transaction; client-supplied totals are advisory only.

## 4. Invoice lifecycle

```text
Draft → Issued → PartiallyPaid → Paid
                 ↘ Void
Issued/PartiallyPaid/Paid → Cancelled only through a governed financial correction
```

| State | Meaning and permitted change |
| --- | --- |
| Draft | Editable working document. It is not collectible, payable, or a final financial record. Draft can be archived under the two-step deletion policy. |
| Issued | Financial snapshot is frozen; it may receive payments. Line items, client, totals, tax, discounts, and due date cannot be edited. |
| PartiallyPaid | Issued invoice with valid completed receipts greater than zero and balance greater than zero. |
| Paid | Valid completed receipts equal the collectible total and balance is zero. |
| Void | No collection occurred; document is voided with required reason. It remains visible and immutable. |
| Cancelled | Historical finance state reached only via a governed linked correction; it is not a destructive delete. |

Issuing requires a valid client, at least one valid line item, calculated totals, authorized actor, unique invoice number, and a full immutable snapshot. Reopening issued invoices is prohibited. If a correction is needed, issue a linked adjustment/credit/refund/reversal record rather than modifying the snapshot. Invoices with any receipt may not be voided; the applicable correction workflow must be used.

## 5. Payment lifecycle and correction events

A payment/receipt is an append-only event referencing the organization, invoice, Client, amount, method, reference, provider information when applicable, initiated/paid timestamps, status, and immutable metadata. It has the operational lifecycle:

```text
Pending → Completed
Pending → Failed
Completed → Refunded | Reversed | Voided (only via a linked correction event)
```

The release must model refunds, reversals, and voids as new linked financial events, not mutations of the original completed receipt. Each correction identifies the original payment, amount, reason, requester, approver when required, provider reference, and time. It may not exceed the amount remaining eligible for correction. The original receipt remains intact and visible.

`Void` applies to an uncollected/invalid authorization or non-settled receipt; `Refund` returns collected funds; `Reversal` corrects a completed financial posting/settlement error. The API must document and enforce the provider-specific semantics rather than letting a UI label choose the result.

High-value correction approval uses an organization-configurable NPR threshold. Finance may initiate a correction; an Owner/Admin distinct from the initiator must approve it at/above the threshold. The approval and execution must be separately audited. The baseline policy is no self-approval for configured high-value corrections.

## 6. Payment methods and provider integration

Cash, card, bank transfer, mobile wallet, insurance, and other methods remain supported as normalized methods. The first provider integration uses a provider-neutral payment adapter and a Fonepay adapter. The contract must support future Nepal payment providers without changing invoice/payment domain semantics.

The adapter boundary owns provider session/order initiation, redirect/deep-link details, callback/webhook parsing, signature verification, status inquiry, refund capability discovery, settlement references, and provider error translation. The core billing module owns authorization, invoice eligibility, idempotency, receipt creation, state transition, and audit event creation.

Fonepay is release-ready only after all of the following are complete: sandbox integration tests; a clinic merchant configuration; encrypted credential storage; verified callback/webhook signature; allowlisted/secured callback endpoint; idempotent processing; status reconciliation; observability; and successful production certification/onboarding required by Fonepay and the clinic. Live enablement is organization-specific and controlled by Owner/Admin plus Super Admin platform feature/configuration controls; no generic live provider credential is shared across clinics.

Every provider request, callback, retry, and reconciliation row has an idempotency key and correlation ID. Replayed callbacks return the original safe result and never create a second receipt. Provider callback data is authenticated before it can alter a payment state; a browser redirect is never proof of payment. Raw provider payloads are access-controlled, redacted in logs, and retained according to the financial retention policy.

## 7. Reconciliation, failure handling, and audit

Provider payments remain `Pending` until verified by a valid callback or server-side status query. A background reconciliation process compares provider transaction/settlement data against internal receipts and flags missing, duplicated, mismatched, failed, expired, and delayed records. Finance resolves exceptions with a reason; no user may silently force a provider payment to completed.

A daily organization reconciliation view reports issued totals, valid collections by method/provider, refunds/reversals, outstanding balances, cash expected, unmatched provider transactions, and aging. Reconciliation actions are append-only and auditable. Finance and Owner/Admin receive actionable exception access; Receptionist does not settle or reconcile.

Audit data includes invoice creation/issue/void/cancellation, every payment/correction state, amount, currency, prior and new states, line/item snapshots, method, provider/reference IDs (masked where displayed), actor, approval, reason, timestamp, correlation ID, and source. Financial records are critical information: they must first be archived and may be permanently deleted only by an Owner from archive after explicit confirmation, and only when retention/legal/audit obligations permit. In normal production operation, financial records should be retained, not purged.

## 8. Current implementation status and ship criteria

The P4B manual-finance slice now provides location-scoped Finance access, idempotent draft creation/issuance/payment recording, immutable completed receipts, append-only Refund/Reversal requests, threshold-based distinct Owner/Admin approval, invoice-ledger reads, and daily read-only reconciliation. Legacy billing mutations return `410 Gone`; retained compatibility reads are tenant- and location-scoped. Finance and Inventory remain independent.

Provider settlement remains intentionally out of scope for P4B. A payment-provider adapter, verified Fonepay callback/webhook, provider intent lifecycle, settlement ingestion, and provider-specific reconciliation exceptions remain P6B release blockers. Financial archive/retention/legal-hold workflows and persisted reconciliation resolution also remain later governed work.

Before release, the system must prove through automated and integration tests that it:

- freezes issued invoice snapshots and derives amounts/balances atomically;
- enforces role/location permissions, including Receptionist record-only authority;
- makes completed payments append-only and applies refunds/reversals/voids as linked events;
- rejects overpayment, cross-organization references, duplicate invoice numbers, unauthorized approval, and deleted/edited completed payments;
- validates Fonepay sandbox signatures, replay/idempotency, failed/late callbacks, reconciliation, and live-enablement safeguards; and
- produces immutable financial audit events and archive-first, Owner-confirmed deletion controls.

Inventory functionality must not be used as a substitute ledger or be automatically coupled to these calculations.

# Inventory Lifecycle and Governance

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Status | Normative release specification |
| Financial boundary | No automatic finance/COGS linkage |

## 1. Purpose and boundary

This specification governs stock items, stock locations, balances, lots, movements, adjustment, archive/deletion, and inventory auditability. Inventory is a shipped product capability but is separate from billing and finance in the first release. A stock movement must not automatically create an invoice line, payment, cost-of-goods-sold entry, tax amount, accounting journal, or invoice adjustment. Any future financial integration requires an approved ADR and a separate finance specification revision.

NestJS inventory services are the only authority for stock reads that expose operational balances and for all inventory writes. All data is organization-scoped; a location belongs to one organization and stock never crosses that boundary.

## 2. Core objects

| Object | Rule |
| --- | --- |
| Item | Organization-owned catalog record for a consumable or stocked product. It has immutable ID, unique organization SKU/code, name, unit of measure, active/archive state, reorder settings, and optional lot/expiry tracking. |
| Stock location | A physical clinic location or separately named storage location within it. Every on-hand balance is location-specific. |
| Lot/batch | Optional traceable item batch with supplier/reference, received date, expiry date, and location-scoped remaining quantity. Required when the item is configured for lot tracking. |
| Movement | Immutable stock ledger event that changes or reserves a balance. It references item, location, quantity, type, actor/system, time, reason/reference, and lot where required. |
| Balance projection | Derived, query-optimized on-hand/reserved/available balance. It is rebuildable from movements and is not the historical source of truth. |

Items must not be silently duplicated across locations. A stock transfer is represented by a linked `TransferOut` movement at the source and `TransferIn` movement at the destination, committed atomically. The supplied item code must be generated atomically within the organization and never reused after archive or deletion.

## 3. Movement types and lifecycle

Allowed movement types are `OpeningBalance`, `Receive`, `Consume`, `AdjustIncrease`, `AdjustDecrease`, `TransferOut`, `TransferIn`, `ReturnToStock`, `Quarantine`, `ReleaseFromQuarantine`, `Waste`, and `StocktakeReconciliation`. Implementations may add types only through a documented migration and state-machine update.

```text
Item: Active → Archived → Permanently deleted
Lot: Available → Quarantined → Exhausted/Expired
Movement: Posted (immutable)
```

Movements are posted once and never edited or deleted. A mistaken movement is corrected by a new linked counter-movement or adjustment with a required reason; the original remains visible. Posting must be transactional: validate organization, permissions, item status, location, lot rules, quantity, sufficient available stock where applicable, write movement, update/rebuild the balance projection, and audit together.

Negative on-hand or available stock is prohibited by default. Owner/Admin may enable a narrowly documented temporary override only if future policy explicitly authorizes it; the initial production release must reject it. Expired or quarantined lots cannot be consumed, transferred out, or returned to available stock without an authorized release/adjustment action.

## 4. Receipt, consumption, and stocktake rules

Receiving requires an item, destination location, positive quantity, unit, source/supplier/reference where known, actor, date, and a lot/expiry value when lot tracking is enabled. It increases on-hand stock only after the movement posts.

Consumption is an explicit inventory operation. It may be linked to a completed clinical Record only for traceability when the organization has configured that workflow; it is never automatically inferred from a service, appointment, invoice, or payment. A Record link does not create a charge, financial cost, or retrospective stock movement. Consumption must identify item/location/quantity and, when required, a lot. Provider or Assistant actors require explicit inventory-consumption permission; Finance does not receive stock authority merely by having finance access.

Stocktakes compare a counted quantity against the derived on-hand quantity. The system records the count evidence and creates a `StocktakeReconciliation` movement for the difference, with a required reason, count time, and authorized approver where configured. A manual adjustment likewise requires a reason and cannot overwrite prior ledger events.

## 5. Inventory roles and access

Owner/Admin hold all inventory permissions. Organizations may grant an Inventory Manager/Storekeeper permission set independently; it is not a Finance role. At minimum:

| Action | Owner/Admin | Inventory Manager/Storekeeper | Provider/Assistant | Receptionist | Finance |
| --- | --- | --- | --- | --- | --- |
| View permitted location stock | Yes | Yes | Optional, limited | Optional, limited | Read-only only if granted |
| Create items/locations | Yes | Configurable | No | No | No |
| Receive/transfer/stocktake/adjust | Yes | Yes, within locations | No | No | No |
| Consume against a Record | Yes | Optional | Explicit permission only | No | No |
| Archive item | Yes | Configurable | No | No | No |
| Permanently delete archived critical data | Owner only | No | No | No | No |

Location-scoped grants must be enforced server-side. An actor cannot infer or alter stock at another organization/location by supplying IDs in a request.

## 6. Reorder, expiry, and operational read models

Each item/location may define reorder point, preferred quantity, safety stock, and optional expiry-alert horizon. Low-stock and expiry alerts are derived read models, not authority to buy or move stock. Alerts must indicate location, current available quantity, threshold, lots affected, source calculation time, and any stale-data state.

The balance projection is invalidated/recomputed after each posted movement. It must be transactionally consistent with the ledger for a committed response, or clearly marked pending/rebuilding and unavailable for stock decisions. Inventory dashboards must not use browser-only cached values to authorize a consumption or transfer.

## 7. Archive, deletion, audit, and privacy

Inventory data is critical operational information. Items, lots, movements, locations, and stocktake evidence cannot be directly deleted. They follow the mandatory two-step lifecycle:

```text
Active → Archived → Owner-confirmed permanent deletion
```

Archive is reversible and preserves the item/location ID, code, balances, movements, reason, actor, and timestamps. Archived items cannot receive, consume, transfer, or be selected for new workflows. They remain viewable to authorized audit users. A permanently delete action is accepted only for an archived target, only from an Owner after explicit target-specific confirmation, and only after retention, legal-hold, audit, and relationship checks pass. Posted movements should normally be retained as an immutable ledger; permanent deletion is expected to be unavailable while any audit/retention obligation applies.

Every material action emits an append-only audit event with organization, target IDs, movement IDs, item/lot/location, actor/roles, quantity/unit, before/after balance projection where safe, reason/reference, request/correlation ID, timestamp, and source. Supplier contacts, purchase references, and operational notes are restricted to the minimum authorized roles and redacted from general analytics/logs.

## 8. Release data model and verification criteria

The current repository contains scheduling `Resource` records but no inventory domain. Resources/chairs are not inventory and must not be repurposed as inventory tables. Before release, add a dedicated inventory module/schema with organization and location tenancy, immutable movement ledger, balance projection, lot tracking configuration, atomic SKU allocation, archive metadata, and audit integration.

The release is ready only when tests demonstrate:

- concurrent receives/consumptions/transfers cannot produce incorrect balances or cross-location transfers;
- movement immutability and compensating corrections work;
- negative stock, expired/quarantined-lot consumption, inactive-item movements, and cross-tenant requests are rejected;
- Record-linked consumption remains optional and does not create billing/finance changes;
- archive/restore and Owner-only explicit-confirmation deletion controls work; and
- location-scoped permissions, audit events, reorder alerts, and balance rebuild/reconciliation are reliable.

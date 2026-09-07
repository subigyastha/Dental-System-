# Inventory standards and future service boundary

**Status:** R0 core audited; staged hardening and extraction roadmap approved for planning.

## Current standards-aligned foundation

The implemented Inventory domain already follows the essential shape used by mature healthcare and general inventory systems:

- immutable stock movements with server-derived before/after balances;
- location-specific balances and explicit inter-location transfers;
- lot and expiry tracking, quarantine/expired/exhausted states, and negative-stock prevention;
- receive, consume/use, adjustment, stocktake and transfer commands;
- supplier references, SKU-based catalog, units, reorder point and preferred-stock controls;
- serializable posting, advisory balance locks, stable idempotency keys, audit rows and compensating corrections;
- role/location authorization, archive-first lifecycle and retained-history protection; and
- strict separation from invoices, payments, COGS and accounting entries.

The hosted PostgreSQL transaction policy is explicitly bounded at a 10-second acquisition wait and 20-second execution deadline, with retry for serialization failures and expired rolled-back transactions. Idempotency prevents a retry from producing a duplicate movement.

## Standards-oriented increments

These are ordered additions, not prerequisites for the current clinic stock core:

1. **Master data:** optional GTIN/barcode, manufacturer and manufacturer part number, medical-device UDI fields where applicable, controlled categories, base unit and unit-of-measure conversions.
2. **Procure-to-receive:** purchase requisition, purchase order, partial receipt/goods-received note, supplier return, cancellation and close states. A receipt posts Inventory only; accounting remains an explicit downstream integration.
3. **Lot governance:** FEFO suggestion, quarantine/release authority, recall/withdrawal workflow, expiry disposal and evidence attachments.
4. **Replenishment:** min/max policy, reorder suggestion, lead time, preferred supplier, open-order quantity and multi-location transfer suggestions.
5. **Clinical issue:** an explicit issue/requisition command may reference a Record in the future. Records never write stock tables and completed clinical work never silently decrements stock.
6. **Valuation adapters:** optional weighted-average/FIFO costing and accounting export belong behind a versioned integration contract. They do not change physical stock truth or create clinic payment records.
7. **Operational assurance:** barcode scan UX, label printing, cycle-count plans, variance approval thresholds, import/export validation, audit export, recall drill and representative-volume performance evidence.

## Extraction-ready ownership rules

Inventory can later move to a separate deployable service if the boundary is enforced now:

- Inventory exclusively owns item, supplier, lot, balance, movement, stocktake, procurement and reorder data.
- Other domains use versioned Inventory commands/queries or events; they never read or write Inventory tables directly.
- Organization, location, actor and optional Record references are opaque external identifiers. Inventory does not own clinic identity or clinical content.
- Every command carries tenant/location scope, actor evidence, idempotency key and correlation/request ID.
- Events are emitted through a transactional outbox after the authoritative stock transaction commits. Consumers treat them as at-least-once and idempotent.
- Recommended event names include `inventory.movement_posted.v1`, `inventory.balance_changed.v1`, `inventory.reorder_triggered.v1`, `inventory.lot_expiring.v1`, and `inventory.stocktake_completed.v1`.
- Finance or accounting integrations consume explicit events/adapters and maintain their own ledger. Inventory availability never depends on those systems.
- Extraction requires an API compatibility layer, backfilled external IDs, dual-read comparison, cutover reconciliation and a rollback plan; it must not begin as a shared-database microservice.

## Acceptance gates

- Concurrent commands cannot create negative stock, duplicate movements or incorrect lot/balance arithmetic.
- Balance can be rebuilt and reconciled from immutable movements.
- Cross-tenant and unauthorized cross-location operations fail without revealing records.
- FEFO, recall/quarantine, UoM conversion and procurement transitions receive explicit state-machine tests when introduced.
- Remote database latency is measured; interactive transactions remain bounded and contain database work only.
- No Inventory command creates or edits invoices, payments or accounting entries.
- A contract test prevents other modules from importing Inventory persistence models/repositories after the extraction boundary package begins.

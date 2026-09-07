"use client";

import {
  AlertTriangle,
  Boxes,
  History,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  Truck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { Button, Panel } from "@/components/ui";
import {
  Drawer,
  EmptyState,
  Field,
  MetricTile,
  PageHeader,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import {
  adjustInventoryStock,
  archiveInventoryItem,
  consumeInventoryStock,
  createInventoryItem,
  createInventorySupplier,
  loadInventoryMovements,
  loadInventoryWorkspace,
  purgeInventoryItem,
  receiveInventoryStock,
  recordInventoryStocktake,
  restoreInventoryItem,
  transferInventoryStock,
  updateInventoryItem,
} from "@/lib/inventory-api";
import type {
  InventoryItem,
  InventoryMovement,
  InventoryWorkspaceData,
} from "@/lib/inventory-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

type InventoryTab = "stock" | "history" | "suppliers";
type StockOperation = "receive" | "consume" | "adjust" | "stocktake" | "transfer";
type DrawerState =
  | { kind: "item"; item?: InventoryItem }
  | { kind: "supplier" }
  | { kind: "operation"; operation: StockOperation; item?: InventoryItem; locationId?: string }
  | { kind: "lifecycle"; action: "archive" | "restore" | "purge"; item: InventoryItem };

export function InventoryWorkspace() {
  const [data, setData] = useState<InventoryWorkspaceData | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [locationId, setLocationId] = useState("");
  const [lifecycle, setLifecycle] = useState<"active" | "archived" | "all">("active");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (background) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const [workspace, history] = await Promise.all([
          loadInventoryWorkspace({
            locationId: locationId || undefined,
            lifecycle,
            query: debouncedQuery || undefined,
            signal,
          }),
          loadInventoryMovements({
            locationId: locationId || undefined,
            signal,
          }),
        ]);
        setData(workspace);
        setMovements(history);
      } catch (requestError) {
        if (!isAbortedRequest(requestError)) {
          setError(requestErrorMessage(requestError, "Could not load Inventory."));
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [debouncedQuery, lifecycle, locationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const onCompleted = useCallback(async () => {
    setDrawer(null);
    await refresh(undefined, true);
  }, [refresh]);

  if (isLoading && !data) return <InventorySkeleton />;

  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Inventory" subtitle="Location stock and immutable movement history." />
        <Panel>
          <div className="p-5">
            <EmptyState
              actionLabel="Retry"
              body={error ?? "Inventory is temporarily unavailable."}
              onAction={() => void refresh()}
              title="Inventory could not load"
            />
          </div>
        </Panel>
      </div>
    );
  }

  const selectedLocationName =
    data.locations.find((location) => location.id === locationId)?.name ?? "All permitted locations";

  return (
    <div className="space-y-5">
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            {data.capabilities.canCreateCatalog ? (
              <>
                <Button onClick={() => setDrawer({ kind: "supplier" })} variant="secondary">
                  <Truck aria-hidden="true" size={16} /> Supplier
                </Button>
                <Button onClick={() => setDrawer({ kind: "item" })} variant="secondary">
                  <Plus aria-hidden="true" size={16} /> Item
                </Button>
              </>
            ) : null}
            {data.capabilities.canOperateStock ? (
              <Button onClick={() => setDrawer({ kind: "operation", operation: "receive", locationId })}>
                <PackagePlus aria-hidden="true" size={16} /> Receive stock
              </Button>
            ) : null}
          </div>
        }
        subtitle="Track consumables by location without changing invoices or payments."
        title="Inventory"
      />

      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)] sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{error}</span>
          <Button onClick={() => void refresh()} variant="secondary">Retry</Button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Active items" value={String(data.summary.activeItemCount)} />
        <MetricTile label="Low stock" value={String(data.summary.lowStockItemCount)} hint="At or below reorder point" />
        <MetricTile label="Out of stock" value={String(data.summary.outOfStockItemCount)} />
        <MetricTile label="Expiring lots" value={String(data.summary.expiringLotCount)} hint="Within 30 days" />
        <MetricTile label="Movements" value={String(data.summary.movementCount)} hint="Immutable ledger entries" />
      </div>

      <Panel>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px_180px_auto]">
            <label className="relative block">
              <span className="sr-only">Search Inventory</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-[var(--text-muted)]" size={16} />
              <input
                className={`${inputClassName} pl-9`}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search item, SKU, or category"
                value={query}
              />
            </label>
            <label>
              <span className="sr-only">Location</span>
              <select className={inputClassName} onChange={(event) => setLocationId(event.target.value)} value={locationId}>
                <option value="">All permitted locations</option>
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Lifecycle</span>
              <select className={inputClassName} onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)} value={lifecycle}>
                <option value="active">Active items</option>
                <option value="archived">Archived items</option>
                <option value="all">All items</option>
              </select>
            </label>
            <Button disabled={isRefreshing} onClick={() => void refresh(undefined, true)} variant="secondary">
              <RotateCcw aria-hidden="true" className={isRefreshing ? "animate-spin" : ""} size={16} />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Showing {selectedLocationName}. Balances are server-derived from posted movements.</p>
        </div>
      </Panel>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist">
        <TabButton active={tab === "stock"} icon={Boxes} label="Stock" onClick={() => setTab("stock")} />
        <TabButton active={tab === "history"} icon={History} label="Movement history" onClick={() => setTab("history")} />
        <TabButton active={tab === "suppliers"} icon={Truck} label="Suppliers" onClick={() => setTab("suppliers")} />
      </div>

      {tab === "stock" ? (
        <StockList
          data={data}
          locationId={locationId}
          onAction={(operation, selectedItem, selectedLocationId) =>
            setDrawer({ kind: "operation", operation, item: selectedItem, locationId: selectedLocationId })
          }
          onEdit={(selectedItem) => setDrawer({ kind: "item", item: selectedItem })}
          onLifecycle={(action, selectedItem) => setDrawer({ kind: "lifecycle", action, item: selectedItem })}
        />
      ) : tab === "history" ? (
        <MovementList movements={movements} />
      ) : (
        <SupplierList data={data} onCreate={() => setDrawer({ kind: "supplier" })} />
      )}

      {drawer?.kind === "item" ? (
        <CatalogDrawer data={data} item={drawer.item} mode="item" onClose={() => setDrawer(null)} onCompleted={onCompleted} />
      ) : null}
      {drawer?.kind === "supplier" ? (
        <CatalogDrawer data={data} mode="supplier" onClose={() => setDrawer(null)} onCompleted={onCompleted} />
      ) : null}
      {drawer?.kind === "operation" ? (
        <StockOperationDrawer
          data={data}
          initialItem={drawer.item}
          initialLocationId={drawer.locationId}
          onClose={() => setDrawer(null)}
          onCompleted={onCompleted}
          operation={drawer.operation}
        />
      ) : null}
      {drawer?.kind === "lifecycle" ? (
        <LifecycleDrawer
          action={drawer.action}
          item={drawer.item}
          onClose={() => setDrawer(null)}
          onCompleted={onCompleted}
        />
      ) : null}
    </div>
  );
}

function StockList({
  data,
  locationId,
  onAction,
  onEdit,
  onLifecycle,
}: {
  data: InventoryWorkspaceData;
  locationId: string;
  onAction: (operation: StockOperation, item: InventoryItem, locationId?: string) => void;
  onEdit: (item: InventoryItem) => void;
  onLifecycle: (action: "archive" | "restore" | "purge", item: InventoryItem) => void;
}) {
  if (!data.items.length) {
    return (
      <Panel><div className="p-5"><EmptyState body="Adjust the search or lifecycle filter, or add the first catalog item." title="No Inventory items found" /></div></Panel>
    );
  }
  return (
    <Panel>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Reorder</th><th className="px-4 py-3">Supplier / lots</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.items.map((item) => (
              <InventoryRow data={data} item={item} key={item.id} locationId={locationId} onAction={onAction} onEdit={onEdit} onLifecycle={onLifecycle} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-[var(--border)] lg:hidden">
        {data.items.map((item) => (
          <InventoryCard data={data} item={item} key={item.id} locationId={locationId} onAction={onAction} onEdit={onEdit} onLifecycle={onLifecycle} />
        ))}
      </div>
    </Panel>
  );
}

function InventoryRow({ data, item, locationId, onAction, onEdit, onLifecycle }: InventoryItemViewProps) {
  const display = balanceDisplay(item, locationId);
  return (
    <tr className={item.archivedAtIso ? "bg-[var(--surface-muted)] opacity-75" : ""}>
      <td className="px-4 py-4"><ItemIdentity item={item} /></td>
      <td className="px-4 py-4"><BalanceLabel display={display} unit={item.unit} /></td>
      <td className="px-4 py-4"><div className="font-medium">{formatQuantity(item.reorderPoint)} {item.unit}</div><div className="text-xs text-[var(--text-muted)]">Target {formatQuantity(item.preferredStock)}</div></td>
      <td className="px-4 py-4"><div>{item.preferredSupplier?.name ?? "No preferred supplier"}</div><div className="text-xs text-[var(--text-muted)]">{item.trackLots ? `${item.lots.length} active lots` : "Lot tracking off"}</div></td>
      <td className="px-4 py-4"><ItemActions data={data} item={item} locationId={locationId} onAction={onAction} onEdit={onEdit} onLifecycle={onLifecycle} /></td>
    </tr>
  );
}

function InventoryCard({ data, item, locationId, onAction, onEdit, onLifecycle }: InventoryItemViewProps) {
  const display = balanceDisplay(item, locationId);
  return (
    <article className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3"><ItemIdentity item={item} /><BalanceLabel display={display} unit={item.unit} /></div>
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs">
        <div><span className="text-[var(--text-muted)]">Reorder</span><div className="mt-1 font-semibold">{formatQuantity(item.reorderPoint)} {item.unit}</div></div>
        <div><span className="text-[var(--text-muted)]">Supplier</span><div className="mt-1 font-semibold">{item.preferredSupplier?.name ?? "Not set"}</div></div>
      </div>
      <ItemActions data={data} item={item} locationId={locationId} onAction={onAction} onEdit={onEdit} onLifecycle={onLifecycle} />
    </article>
  );
}

type InventoryItemViewProps = {
  data: InventoryWorkspaceData;
  item: InventoryItem;
  locationId: string;
  onAction: (operation: StockOperation, item: InventoryItem, locationId?: string) => void;
  onEdit: (item: InventoryItem) => void;
  onLifecycle: (action: "archive" | "restore" | "purge", item: InventoryItem) => void;
};

function ItemIdentity({ item }: { item: InventoryItem }) {
  return <div><div className="font-semibold text-[var(--foreground)]">{item.name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{item.sku} · {item.category || "Uncategorized"}{item.archivedAtIso ? " · Archived" : ""}</div></div>;
}

function BalanceLabel({ display, unit }: { display: ReturnType<typeof balanceDisplay>; unit: string }) {
  return <div className="text-right lg:text-left"><div className="font-semibold text-[var(--foreground)]">{formatQuantity(display.quantity)} {unit}</div><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${display.isLow ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--brand-strong)]"}`}>{display.isOut ? "Out of stock" : display.isLow ? "Low stock" : "In stock"}</span></div>;
}

function ItemActions({ data, item, locationId, onAction, onEdit, onLifecycle }: InventoryItemViewProps) {
  const preferredLocation = locationId || data.operationLocationIds[0];
  if (item.archivedAtIso) {
    return <div className="flex flex-wrap gap-2">{data.capabilities.canArchiveCatalog ? <Button onClick={() => onLifecycle("restore", item)} variant="secondary">Restore</Button> : null}{data.capabilities.canPurgeCatalog ? <Button onClick={() => onLifecycle("purge", item)} variant="ghost">Delete permanently</Button> : null}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {data.capabilities.canCreateCatalog ? <Button onClick={() => onEdit(item)} variant="ghost">Edit</Button> : null}
      {data.capabilities.canOperateStock && preferredLocation ? (
        <>
          <Button onClick={() => onAction("receive", item, preferredLocation)} variant="secondary">Receive</Button>
          <Button onClick={() => onAction("consume", item, preferredLocation)} variant="ghost">Use</Button>
          <Button onClick={() => onAction("stocktake", item, preferredLocation)} variant="ghost">Count</Button>
          {data.operationLocationIds.length > 1 ? <Button onClick={() => onAction("transfer", item, preferredLocation)} variant="ghost">Move</Button> : null}
          <Button onClick={() => onAction("adjust", item, preferredLocation)} variant="ghost">Adjust</Button>
        </>
      ) : null}
      {data.capabilities.canArchiveCatalog ? <Button onClick={() => onLifecycle("archive", item)} variant="ghost">Archive</Button> : null}
    </div>
  );
}

function MovementList({ movements }: { movements: InventoryMovement[] }) {
  if (!movements.length) return <Panel><div className="p-5"><EmptyState body="Receiving, usage, transfer, adjustment, and count corrections appear here after posting." title="No stock movements yet" /></div></Panel>;
  return (
    <Panel>
      <div className="divide-y divide-[var(--border)]">
        {movements.map((movement) => (
          <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_180px_160px] sm:items-center" key={movement.id}>
            <div><div className="font-semibold">{movement.item.name} <span className="font-normal text-[var(--text-muted)]">· {movement.item.sku}</span></div><div className="mt-1 text-xs text-[var(--text-muted)]">{movementLabel(movement.type)} · {movement.location.name}{movement.lot ? ` · Lot ${movement.lot.lotNumber}` : ""} · {movement.reason}</div></div>
            <div className={Number(movement.quantityDelta) < 0 ? "font-semibold text-[var(--danger)]" : "font-semibold text-[var(--brand-strong)]"}>{Number(movement.quantityDelta) > 0 ? "+" : ""}{formatQuantity(movement.quantityDelta)} {movement.item.unit}<div className="text-xs font-normal text-[var(--text-muted)]">Balance {formatQuantity(movement.balanceAfter)}</div></div>
            <div className="text-xs text-[var(--text-muted)]">{new Date(movement.occurredAtIso).toLocaleString()}<div className="mt-1">{movement.postedBy.name}</div></div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function SupplierList({ data, onCreate }: { data: InventoryWorkspaceData; onCreate: () => void }) {
  if (!data.suppliers.length) return <Panel><div className="p-5"><EmptyState actionLabel={data.capabilities.canCreateCatalog ? "Add supplier" : undefined} body="Supplier details are optional for ordinary stock, but useful for receiving references and lot traceability." onAction={onCreate} title="No suppliers yet" /></div></Panel>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.suppliers.map((supplier) => <Panel key={supplier.id}><div className="p-4"><div className="font-semibold">{supplier.name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{supplier.code}</div><div className="mt-4 text-sm">{supplier.contactName || "No contact name"}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{supplier.phone || "No phone"}</div></div></Panel>)}</div>;
}

function CatalogDrawer({ data, item, mode, onClose, onCompleted }: { data: InventoryWorkspaceData; item?: InventoryItem; mode: "item" | "supplier"; onClose: () => void; onCompleted: () => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackLots, setTrackLots] = useState(item?.trackLots ?? false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSaving(true); setError(null);
    try {
      if (mode === "item") {
        const itemInput = {
          name: String(form.get("name") ?? "").trim(),
          category: optional(form, "category"), description: optional(form, "description"),
          unit: String(form.get("unit") ?? "").trim(), trackLots,
          reorderPoint: String(form.get("reorderPoint") ?? "0"), preferredStock: String(form.get("preferredStock") ?? "0"),
          preferredSupplierId: String(form.get("preferredSupplierId") ?? ""),
        };
        if (item) await updateInventoryItem(item.id, itemInput);
        else await createInventoryItem({ sku: String(form.get("sku") ?? "").trim().toUpperCase(), ...itemInput });
      } else {
        await createInventorySupplier({
          code: String(form.get("code") ?? "").trim().toUpperCase(), name: String(form.get("name") ?? "").trim(),
          contactName: optional(form, "contactName"), phone: optional(form, "phone"), email: optional(form, "email"), address: optional(form, "address"), notes: optional(form, "notes"),
        });
      }
      await onCompleted();
    } catch (requestError) { setError(requestErrorMessage(requestError, `Could not ${item ? "update" : "create"} the ${mode}.`)); }
    finally { setIsSaving(false); }
  }
  return (
    <Drawer closeDisabled={isSaving} context={mode === "item" ? "Organization catalog settings. Stock remains location-specific." : "Optional receiving and traceability contact."} onClose={onClose} title={mode === "item" ? item ? "Edit Inventory item" : "New Inventory item" : "New supplier"}>
      <form className="flex min-h-full flex-col" onSubmit={submit}>
        <div className="space-y-4">
          {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2"><Field label={mode === "item" ? "SKU" : "Supplier code"}><input autoFocus className={inputClassName} defaultValue={item?.sku} disabled={Boolean(item)} name={mode === "item" ? "sku" : "code"} pattern="[A-Z0-9][A-Z0-9._-]{1,31}" required /></Field><Field label="Name"><input className={inputClassName} defaultValue={item?.name} maxLength={120} name="name" required /></Field></div>
          {mode === "item" ? <><div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><input className={inputClassName} defaultValue={item?.category ?? ""} maxLength={80} name="category" /></Field><Field label="Unit"><input className={inputClassName} defaultValue={item?.unit} maxLength={24} name="unit" placeholder="box, piece, ml…" required /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Reorder point"><input className={inputClassName} defaultValue={item?.reorderPoint ?? "0"} min="0" name="reorderPoint" step="0.001" type="number" required /></Field><Field label="Preferred stock"><input className={inputClassName} defaultValue={item?.preferredStock ?? "0"} min="0" name="preferredStock" step="0.001" type="number" required /></Field></div><Field label="Preferred supplier"><select className={inputClassName} defaultValue={item?.preferredSupplier?.id ?? ""} name="preferredSupplierId"><option value="">None</option>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] p-3"><input checked={trackLots} onChange={(event) => setTrackLots(event.target.checked)} type="checkbox" /><span><span className="block text-sm font-medium">Track lots and expiry</span><span className="block text-xs text-[var(--text-muted)]">Every movement will require a traceable lot. This setting locks after the first movement.</span></span></label><Field label="Description"><textarea className={textareaClassName} defaultValue={item?.description ?? ""} maxLength={500} name="description" /></Field></> : <><div className="grid gap-4 sm:grid-cols-2"><Field label="Contact name"><input className={inputClassName} maxLength={120} name="contactName" /></Field><Field label="Phone"><input className={inputClassName} maxLength={40} name="phone" type="tel" /></Field></div><Field label="Email"><input className={inputClassName} maxLength={160} name="email" type="email" /></Field><Field label="Address"><input className={inputClassName} maxLength={240} name="address" /></Field><Field label="Notes"><textarea className={textareaClassName} maxLength={500} name="notes" /></Field></>}
        </div>
        <div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] py-4"><Button disabled={isSaving} onClick={onClose} variant="secondary">Cancel</Button><Button loading={isSaving} loadingLabel="Saving…" type="submit">{item ? "Save changes" : `Create ${mode}`}</Button></div>
      </form>
    </Drawer>
  );
}

function StockOperationDrawer({ data, operation, initialItem, initialLocationId, onClose, onCompleted }: { data: InventoryWorkspaceData; operation: StockOperation; initialItem?: InventoryItem; initialLocationId?: string; onClose: () => void; onCompleted: () => Promise<void> }) {
  const [itemId, setItemId] = useState(initialItem?.id ?? data.items.find((item) => !item.archivedAtIso)?.id ?? "");
  const [locationId, setLocationId] = useState(initialLocationId && data.operationLocationIds.includes(initialLocationId) ? initialLocationId : data.operationLocationIds[0] ?? "");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const selectedItem = data.items.find((item) => item.id === itemId);
  const availableLots = selectedItem?.lots.filter(
    (lot) =>
      lot.locationId === locationId &&
      (operation === "consume" || operation === "transfer"
        ? lot.status === "Available"
        : true),
  ) ?? [];
  const title = { receive: "Receive stock", consume: "Record stock usage", adjust: "Adjust stock", stocktake: "Record stocktake", transfer: "Transfer stock" }[operation];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setIsSaving(true); setError(null);
    const quantity = String(form.get("quantity") ?? ""); const lotId = optional(form, "lotId"); const reason = String(form.get("reason") ?? "").trim();
    try {
      if (operation === "receive") await receiveInventoryStock({ itemId, locationId, quantity, supplierId: optional(form, "supplierId"), lotNumber: optional(form, "lotNumber"), expiresAtIso: dateToIso(optional(form, "expiresAt")), sourceReference: optional(form, "sourceReference"), reason }, idempotencyKey);
      else if (operation === "consume") await consumeInventoryStock({ itemId, locationId, quantity, lotId, sourceReference: optional(form, "sourceReference"), reason }, idempotencyKey);
      else if (operation === "adjust") await adjustInventoryStock({ itemId, locationId, direction, quantity, lotId, sourceReference: optional(form, "sourceReference"), reason }, idempotencyKey);
      else if (operation === "stocktake") await recordInventoryStocktake({ itemId, locationId, countedQuantity: quantity, lotId, countedAtIso: new Date().toISOString(), reason }, idempotencyKey);
      else await transferInventoryStock({ itemId, sourceLocationId: locationId, destinationLocationId: String(form.get("destinationLocationId") ?? ""), quantity, sourceLotId: lotId, reason }, idempotencyKey);
      await onCompleted();
    } catch (requestError) { setError(requestErrorMessage(requestError, `Could not ${title.toLowerCase()}.`)); }
    finally { setIsSaving(false); }
  }
  return (
    <Drawer closeDisabled={isSaving} context="Posting waits for the authoritative Inventory transaction and cannot change Finance records." onClose={onClose} title={title}>
      <form className="flex min-h-full flex-col" onSubmit={submit}><div className="space-y-4">
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
        <Field label="Item"><select autoFocus className={inputClassName} disabled={Boolean(initialItem)} onChange={(event) => setItemId(event.target.value)} required value={itemId}><option value="">Select item</option>{data.items.filter((item) => !item.archivedAtIso).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></Field>
        <Field label={operation === "transfer" ? "Source location" : "Location"}><select className={inputClassName} onChange={(event) => setLocationId(event.target.value)} required value={locationId}>{data.locations.filter((location) => data.operationLocationIds.includes(location.id)).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
        {operation === "transfer" ? <Field label="Destination location"><select className={inputClassName} name="destinationLocationId" required><option value="">Select destination</option>{data.locations.filter((location) => data.operationLocationIds.includes(location.id) && location.id !== locationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field> : null}
        {operation === "adjust" ? <Field label="Adjustment direction"><select className={inputClassName} onChange={(event) => setDirection(event.target.value as typeof direction)} value={direction}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></Field> : null}
        <Field label={operation === "stocktake" ? "Counted quantity" : "Quantity"}><input className={inputClassName} min={operation === "stocktake" ? "0" : "0.001"} name="quantity" required step="0.001" type="number" /></Field>
        {selectedItem?.trackLots && operation === "receive" ? <><Field label="Lot number"><input className={inputClassName} maxLength={80} name="lotNumber" required /></Field><Field label="Expiry date (optional)"><input className={inputClassName} min={new Date().toISOString().slice(0, 10)} name="expiresAt" type="date" /></Field></> : null}
        {selectedItem?.trackLots && operation !== "receive" ? <Field label="Lot"><select className={inputClassName} name="lotId" required><option value="">Select lot</option>{availableLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.lotNumber} · {formatQuantity(lot.quantity)} {selectedItem.unit}</option>)}</select></Field> : null}
        {operation === "receive" ? <Field label="Supplier (optional)"><select className={inputClassName} name="supplierId"><option value="">Not recorded</option>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field> : null}
        {operation === "receive" || operation === "consume" || operation === "adjust" ? <Field label="Reference (optional)"><input className={inputClassName} maxLength={120} name="sourceReference" placeholder={operation === "receive" ? "Delivery note or GRN" : "Record or internal reference"} /></Field> : null}
        <Field label="Reason"><textarea className={textareaClassName} maxLength={500} minLength={3} name="reason" required /></Field>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text-muted)]">Movements are immutable. If this entry is wrong, post a compensating adjustment with its own reason.</div>
      </div><div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] py-4"><Button disabled={isSaving} onClick={onClose} variant="secondary">Cancel</Button><Button loading={isSaving} loadingLabel="Posting…" type="submit">Post {operation === "stocktake" ? "count" : "movement"}</Button></div></form>
    </Drawer>
  );
}

function LifecycleDrawer({ action, item, onClose, onCompleted }: { action: "archive" | "restore" | "purge"; item: InventoryItem; onClose: () => void; onCompleted: () => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setIsSaving(true); setError(null); try { if (action === "archive") await archiveInventoryItem(item.id, String(form.get("reason") ?? "")); else if (action === "restore") await restoreInventoryItem(item.id, String(form.get("reason") ?? "")); else await purgeInventoryItem(item.id, String(form.get("confirmation") ?? "")); await onCompleted(); } catch (requestError) { setError(requestErrorMessage(requestError, `Could not ${action} the Inventory item.`)); } finally { setIsSaving(false); } }
  return <Drawer closeDisabled={isSaving} context={`${item.name} · ${item.sku}`} onClose={onClose} title={action === "archive" ? "Archive Inventory item" : action === "restore" ? "Restore Inventory item" : "Permanently delete Inventory item"}><form className="flex min-h-full flex-col" onSubmit={submit}><div className="space-y-4">{error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}{action === "purge" ? <><div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"><AlertTriangle className="mr-2 inline" size={16} />Only unused archived items without stock history can be permanently deleted.</div><Field label={`Type ${item.sku} to confirm`}><input autoComplete="off" autoFocus className={inputClassName} name="confirmation" required /></Field></> : <Field label="Reason"><textarea autoFocus className={textareaClassName} maxLength={500} minLength={3} name="reason" required /></Field>}</div><div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] py-4"><Button disabled={isSaving} onClick={onClose} variant="secondary">Cancel</Button><Button loading={isSaving} loadingLabel="Saving…" type="submit">{action === "archive" ? "Archive" : action === "restore" ? "Restore" : "Delete permanently"}</Button></div></form></Drawer>;
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Boxes; label: string; onClick: () => void }) {
  return <button aria-selected={active} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium ${active ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]" : "text-[var(--text-muted)] hover:bg-[var(--color-hover)]"}`} onClick={onClick} role="tab" type="button"><Icon aria-hidden="true" size={16} />{label}</button>;
}

function InventorySkeleton() {
  return <div aria-busy="true" className="space-y-5" role="status"><span className="sr-only">Loading Inventory</span><div className="h-16 animate-pulse rounded-xl bg-[var(--surface-muted)] motion-reduce:animate-none" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div className="h-28 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" key={index} />)}</div><div className="h-96 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" /></div>;
}

function balanceDisplay(item: InventoryItem, locationId: string) {
  if (locationId) {
    const balance = item.balances.find((entry) => entry.locationId === locationId);
    return { quantity: balance?.quantity ?? "0", isLow: balance?.isLowStock ?? true, isOut: balance?.isOutOfStock ?? true };
  }
  return { quantity: item.totalQuantity, isLow: item.lowStockLocationCount > 0, isOut: item.balances.some((entry) => entry.isOutOfStock) };
}

function optional(form: FormData, key: string) { const value = String(form.get(key) ?? "").trim(); return value || undefined; }
function dateToIso(value: string | undefined) { return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined; }
function formatQuantity(value: string) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }); }
function createIdempotencyKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function movementLabel(type: InventoryMovement["type"]) { return ({ Receive: "Received", Consume: "Used", AdjustIncrease: "Adjustment increase", AdjustDecrease: "Adjustment decrease", TransferOut: "Transferred out", TransferIn: "Transferred in", StocktakeReconciliation: "Count reconciliation", OpeningBalance: "Opening balance", ReturnToStock: "Returned to stock", Quarantine: "Quarantined", ReleaseFromQuarantine: "Released from quarantine", Waste: "Waste" } as Record<InventoryMovement["type"], string>)[type]; }

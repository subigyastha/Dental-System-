"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useRef } from "react";

import { Button } from "@/components/ui";
import {
  Drawer,
  Field,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import {
  createFinanceInvoice,
  searchFinanceClients,
  type FinanceClientOption,
} from "@/lib/finance-api";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

export function CreateInvoiceDrawer({
  locations,
  onClose,
  onCreated,
}: {
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (invoiceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<FinanceClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchFinanceClients(query, controller.signal)
        .then((items) => {
          setClients(items);
        })
        .catch((cause: unknown) => {
          if (!isAbortedRequest(cause)) {
            setError(requestErrorMessage(cause, "Clients could not be searched."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(unitPrice);
    if (!clientId || !locationId) {
      setError("Select a Client and clinic location before creating the invoice.");
      return;
    }
    if (
      !description.trim() ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0
    ) {
      setError("Enter a valid line description, quantity, and unit price.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = {
        locationId,
        clientId,
        dueAtIso: dueDate ? `${dueDate}T09:00:00+05:45` : undefined,
        notes: notes.trim() || undefined,
        lineItems: [
          {
            description: description.trim(),
            quantity: parsedQuantity,
            unitPriceNpr: parsedPrice.toFixed(2),
          },
        ],
      };
      const fingerprint = JSON.stringify(input);
      const attempt =
        attemptRef.current?.fingerprint === fingerprint
          ? attemptRef.current
          : {
              fingerprint,
              key:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `invoice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            };
      attemptRef.current = attempt;
      const result = await createFinanceInvoice(input, attempt.key);
      onCreated(result.invoice.id);
    } catch (cause) {
      setError(requestErrorMessage(cause, "The draft invoice could not be created."));
      setSaving(false);
    }
  }

  return (
    <Drawer
      closeDisabled={saving}
      context="Select an existing Client and add the initial immutable line-item input."
      onClose={onClose}
      title="New draft invoice"
    >
      <form className="space-y-5" onSubmit={submit}>
        <Field label="Search Clients">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-3.5 text-[var(--text-muted)]"
              size={16}
            />
            <input
              autoComplete="off"
              className={`${inputClassName} pl-9`}
              onChange={(event) => {
                setQuery(event.target.value);
                setClientId("");
                setError(null);
              }}
              placeholder="Name, number, or Client code"
              value={query}
            />
          </div>
        </Field>

        <fieldset>
          <legend className="text-sm font-medium">Client</legend>
          <div
            aria-busy={searching}
            className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-[var(--border)] p-2"
          >
            {clients.map((client) => (
              <label
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border p-3 ${
                  clientId === client.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-transparent hover:bg-[var(--surface-muted)]"
                }`}
                key={client.id}
              >
                <input
                  checked={clientId === client.id}
                  name="client"
                  onChange={() => setClientId(client.id)}
                  type="radio"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {client.name}
                  </span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {[client.clientCode, client.phone].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            ))}
            {!searching && !clients.length ? (
              <p className="p-3 text-sm text-[var(--text-muted)]">
                No active Clients match this search.
              </p>
            ) : null}
            {searching ? (
              <p aria-live="polite" className="p-3 text-sm text-[var(--text-muted)]">
                Searching Clients…
              </p>
            ) : null}
          </div>
        </fieldset>

        <Field label="Clinic location">
          <select
            className={inputClassName}
            onChange={(event) => setLocationId(event.target.value)}
            required
            value={locationId}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Line description">
          <input
            className={inputClassName}
            onChange={(event) => setDescription(event.target.value)}
            required
            value={description}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <input
              className={inputClassName}
              min="1"
              onChange={(event) => setQuantity(event.target.value)}
              required
              step="1"
              type="number"
              value={quantity}
            />
          </Field>
          <Field label="Unit price (NPR)">
            <input
              className={inputClassName}
              inputMode="decimal"
              min="0"
              onChange={(event) => setUnitPrice(event.target.value)}
              required
              step="0.01"
              type="number"
              value={unitPrice}
            />
          </Field>
        </div>
        <Field label="Due date (AD, optional)">
          <input
            className={inputClassName}
            onChange={(event) => setDueDate(event.target.value)}
            type="date"
            value={dueDate}
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            className={textareaClassName}
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </Field>

        {error ? (
          <p
            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="sticky -bottom-5 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button disabled={saving} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            loading={saving}
            loadingLabel="Creating draft"
            type="submit"
          >
            Create draft
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

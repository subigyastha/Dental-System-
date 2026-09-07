"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui";
import {
  Drawer,
  Field,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import { recordFinancePayment } from "@/lib/finance-api";
import {
  formatNpr,
  isPositiveMoney,
  requiresPaymentReference,
  type FinanceInvoiceDetail,
} from "@/lib/finance-domain";
import { requestErrorMessage } from "@/lib/request-error";

type PaymentMethod =
  | "Cash"
  | "Card"
  | "BankTransfer"
  | "MobileWallet"
  | "Insurance"
  | "Other";

type Attempt = { fingerprint: string; idempotencyKey: string };

export function RecordPaymentDrawer({
  invoice,
  onClose,
  onRecorded,
}: {
  invoice: FinanceInvoiceDetail;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [amountNpr, setAmountNpr] = useState(invoice.balanceNpr);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [receivedAt, setReceivedAt] = useState(nowForDateTimeInput());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const lockRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    if (
      !isPositiveMoney(amountNpr) ||
      Number(amountNpr) > Number(invoice.balanceNpr)
    ) {
      setError(`Enter an amount up to ${formatNpr(invoice.balanceNpr)}.`);
      return;
    }
    if (requiresPaymentReference(method) && !referenceNumber.trim()) {
      setError("A provider or transaction reference is required for non-cash payments.");
      return;
    }
    if (!invoice.locationId) {
      setError("This invoice has no location and cannot receive a payment.");
      return;
    }
    const paidAt = new Date(`${receivedAt}:00+05:45`);
    if (!receivedAt || Number.isNaN(paidAt.getTime())) {
      setError("Enter a valid received date and time.");
      return;
    }

    const fingerprint = JSON.stringify({
      amountNpr,
      method,
      receivedAt,
      referenceNumber: referenceNumber.trim(),
      notes: notes.trim(),
    });
    const attempt =
      attemptRef.current?.fingerprint === fingerprint
        ? attemptRef.current
        : {
            fingerprint,
            idempotencyKey:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          };
    attemptRef.current = attempt;
    lockRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await recordFinancePayment({
        invoiceId: invoice.id,
        locationId: invoice.locationId,
        amountNpr,
        method,
        paidAtIso: paidAt.toISOString(),
        referenceNumber: referenceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey: attempt.idempotencyKey,
      });
      onRecorded();
    } catch (cause) {
      setError(
        `${requestErrorMessage(cause, "The payment could not be recorded.")} No balance has been changed locally; retrying unchanged details is safe.`,
      );
    } finally {
      lockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Drawer
      closeDisabled={saving}
      context={`${invoice.invoiceNumber} · ${invoice.clientName} · balance ${formatNpr(invoice.balanceNpr)}`}
      onClose={onClose}
      title="Record completed payment"
    >
      <form className="space-y-5" onSubmit={submit}>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Record only money already received. This creates an immutable completed
          receipt; it does not initiate a provider payment.
        </div>

        <Field label="Amount received (NPR)">
          <input
            className={inputClassName}
            inputMode="decimal"
            max={invoice.balanceNpr}
            min="0.01"
            onChange={(event) => setAmountNpr(event.target.value)}
            required
            step="0.01"
            type="number"
            value={amountNpr}
          />
        </Field>
        <Field label="Payment method">
          <select
            className={inputClassName}
            onChange={(event) => {
              setMethod(event.target.value as PaymentMethod);
              setReferenceNumber("");
            }}
            value={method}
          >
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="BankTransfer">Bank transfer</option>
            <option value="MobileWallet">Mobile wallet / QR</option>
            <option value="Insurance">Insurance</option>
            <option value="Other">Other</option>
          </select>
        </Field>
        <Field label="Received date and time">
          <input
            className={inputClassName}
            onChange={(event) => setReceivedAt(event.target.value)}
            required
            type="datetime-local"
            value={receivedAt}
          />
        </Field>
        {requiresPaymentReference(method) ? (
          <Field label="Required transaction reference">
            <input
              autoComplete="off"
              className={inputClassName}
              onChange={(event) => setReferenceNumber(event.target.value)}
              required
              value={referenceNumber}
            />
          </Field>
        ) : null}
        <Field label="Internal notes (optional)">
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
            loadingLabel="Recording payment"
            type="submit"
          >
            Record payment
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function nowForDateTimeInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

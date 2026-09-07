"use client";

import { ChevronLeft } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui";
import {
  Drawer,
  Field,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import { requestFinancialCorrection } from "@/lib/finance-api";
import {
  formatNpr,
  isPositiveMoney,
  maskFinanceReference,
  type CorrectionKind,
  type FinanceCorrection,
} from "@/lib/finance-domain";
import { requestErrorMessage } from "@/lib/request-error";

import type { CorrectionTarget } from "./invoice-detail-drawer";

type Attempt = {
  fingerprint: string;
  idempotencyKey: string;
};

export function FinancialCorrectionDrawer({
  onBack,
  onClose,
  onSubmitted,
  target,
}: {
  onBack: () => void;
  onClose: () => void;
  onSubmitted: (correction: FinanceCorrection) => void;
  target: CorrectionTarget;
}) {
  const maximum = target.payment.correctableNpr ?? target.payment.amountNpr;
  const [kind, setKind] = useState<CorrectionKind>("Refund");
  const [amountNpr, setAmountNpr] = useState(maximum);
  const [reason, setReason] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    if (!isPositiveMoney(amountNpr) || Number(amountNpr) > Number(maximum)) {
      setError(`Enter an amount up to ${formatNpr(maximum)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A correction reason is required.");
      return;
    }
    if (!target.payment.paymentId) {
      setError("The original payment reference is unavailable.");
      return;
    }

    const fingerprint = JSON.stringify({
      kind,
      amountNpr,
      reason: reason.trim(),
      providerReference: providerReference.trim(),
    });
    const attempt =
      attemptRef.current?.fingerprint === fingerprint
        ? attemptRef.current
        : {
            fingerprint,
            idempotencyKey:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `finance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          };
    attemptRef.current = attempt;
    lockRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await requestFinancialCorrection({
        invoiceId: target.invoice.id,
        paymentId: target.payment.paymentId,
        idempotencyKey: attempt.idempotencyKey,
        kind,
        amountNpr,
        reason: reason.trim(),
        providerReference: providerReference.trim() || undefined,
      });
      onSubmitted(result.correction);
    } catch (cause) {
      setError(
        `${requestErrorMessage(cause, "The correction could not be submitted.")} Your original receipt remains unchanged. Retrying with unchanged details is safe.`,
      );
    } finally {
      lockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Drawer
      closeDisabled={saving}
      context={`${target.invoice.invoiceNumber} · ${target.invoice.clientName}`}
      onClose={onClose}
      stepLabel="Governed financial correction"
      title="Refund or reverse payment"
    >
      <form className="space-y-5" onSubmit={submit}>
        <Button
          className="min-h-11"
          disabled={saving}
          onClick={onBack}
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" size={16} />
          Back to invoice
        </Button>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--text-muted)]">Original completed receipt</p>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {formatNpr(target.payment.amountNpr)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {target.payment.method ?? "Method unavailable"} ·{" "}
            {maskFinanceReference(target.payment.reference)}
          </p>
          <p className="mt-3 text-sm">
            Remaining eligible:{" "}
            <strong className="tabular-nums">{formatNpr(maximum)}</strong>
          </p>
        </section>

        <fieldset>
          <legend className="text-sm font-medium">Correction type</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <CorrectionChoice
              active={kind === "Refund"}
              description="Money is returned to the Client."
              label="Refund"
              onClick={() => setKind("Refund")}
            />
            <CorrectionChoice
              active={kind === "Reversal"}
              description="The original receipt was recorded or settled in error."
              label="Reversal"
              onClick={() => setKind("Reversal")}
            />
          </div>
        </fieldset>

        <Field label="Correction amount (NPR)">
          <input
            className={inputClassName}
            inputMode="decimal"
            max={maximum}
            min="0.01"
            onChange={(event) => setAmountNpr(event.target.value)}
            required
            step="0.01"
            type="number"
            value={amountNpr}
          />
        </Field>
        <Field label="Required reason">
          <textarea
            className={textareaClassName}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </Field>
        <Field label="Provider reference (when applicable)">
          <input
            className={inputClassName}
            onChange={(event) => setProviderReference(event.target.value)}
            value={providerReference}
          />
        </Field>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          The original receipt remains in the ledger. If executed, the invoice
          balance increases by {formatNpr(amountNpr || "0")}. Corrections above
          clinic policy may require approval by a different Owner or Admin.
        </div>

        {error ? (
          <p
            aria-live="assertive"
            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="sticky -bottom-5 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            className="min-h-11"
            disabled={saving}
            onClick={onBack}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="min-h-11"
            loading={saving}
            loadingLabel="Submitting correction"
            type="submit"
          >
            Submit correction
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function CorrectionChoice({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-20 rounded-lg border p-3 text-left ${
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="block font-semibold">{label}</span>
      <span className="mt-1 block text-xs text-[var(--text-muted)]">
        {description}
      </span>
    </button>
  );
}

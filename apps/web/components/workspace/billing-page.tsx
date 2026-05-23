"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus } from "lucide-react";

import { KoiInlineLoader } from "@/components/koi-loader";
import { Button, Panel } from "@/components/ui";
import {
  InvoiceDraft,
  PaymentDraft,
  useWorkspaceApp,
} from "@/components/workspace/app-state";
import {
  EmptyState,
  Field,
  Modal,
  PageHeader,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import { formatDualDate } from "@/components/workspace/workspace-utils";
import type { Invoice } from "@/lib/domain";

const billingRoles = new Set(["Owner", "Admin", "Manager", "Receptionist", "Scheduler"]);

export function BillingPage() {
  const { calendarMode, createInvoice, data, deleteInvoice, invoices, invoicesLoaded, invoicesLoading, loadInvoices, recordPayment, sessionUser } =
    useWorkspaceApp();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (sessionUser && billingRoles.has(sessionUser.role) && !invoicesLoaded && !invoicesLoading) {
      void loadInvoices();
    }
  }, [invoicesLoaded, invoicesLoading, loadInvoices, sessionUser]);

  const rows = useMemo(() => {
    return invoices.map((invoice) => ({
      ...invoice,
      customer: data.customers.find((customer) => customer.id === invoice.customerId),
      appointment: data.appointments.find((appointment) => appointment.id === invoice.appointmentId),
    }));
  }, [data.appointments, data.customers, invoices]);

  if (!sessionUser || !billingRoles.has(sessionUser.role)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Billing" subtitle="This area is only available to finance-capable clinic roles." />
        <EmptyState
          body="Owner, admin, manager, receptionist, and scheduler accounts can create invoices and record payments here."
          title="Billing permissions required"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing"
        subtitle="Invoices and payments, without making the page feel like accounting software from 2009."
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} />
            New invoice
          </Button>
        }
      />

      <Panel title="Invoices">
        {invoicesLoading && !invoicesLoaded ? (
          <KoiInlineLoader label="Loading invoices" />
        ) : rows.length ? (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((invoice) => (
              <div className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1.3fr)_160px_160px_220px]" key={invoice.id}>
                <div>
                  <div className="font-medium text-[var(--foreground)]">{invoice.invoiceNumber}</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">
                    {invoice.customer?.name ?? "Unknown patient"}
                  </div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">
                    Issued {formatDualDate(invoice.issuedAtIso, calendarMode, "short")}
                  </div>
                </div>
                <div className="text-sm">
                  <div className="font-medium text-[var(--foreground)]">Rs {invoice.totalAmount.toFixed(2)}</div>
                  <div className="mt-1 text-[var(--text-muted)]">Balance Rs {invoice.balanceAmount.toFixed(2)}</div>
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                    {invoice.appointment ? formatDualDate(invoice.appointment.startsAtIso, calendarMode, "short") : "No appointment linked"}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <InvoiceStatusBadge status={invoice.status} />
                  <Button onClick={() => setPaymentInvoice(invoice)} variant="secondary">
                    <CreditCard size={16} />
                    Payment
                  </Button>
                  {invoice.status === "Draft" ? (
                    <Button onClick={() => void deleteInvoice(invoice.id)} variant="ghost">
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              actionLabel="Create invoice"
              body="No invoices have been created yet."
              onAction={() => setIsCreateOpen(true)}
              title="Billing is empty"
            />
          </div>
        )}
      </Panel>

      {isCreateOpen ? (
        <InvoiceModal
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (draft) => {
            await createInvoice(draft);
            setIsCreateOpen(false);
          }}
        />
      ) : null}

      {paymentInvoice ? (
        <PaymentModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onSubmit={async (draft) => {
            await recordPayment(paymentInvoice.id, draft);
            setPaymentInvoice(null);
          }}
        />
      ) : null}
    </div>
  );
}

function InvoiceModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (draft: InvoiceDraft) => Promise<void>;
}) {
  const { data } = useWorkspaceApp();
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [appointmentId, setAppointmentId] = useState("");
  const [description, setDescription] = useState("Consultation");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const customerAppointments = data.appointments.filter((appointment) => appointment.customerId === customerId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit({
        customerId,
        appointmentId: appointmentId || undefined,
        dueAtIso: dueDate ? `${dueDate}T09:00:00+05:45` : undefined,
        notes: notes || undefined,
        lineItems: appointmentId
          ? []
          : [
              {
                description,
                quantity,
                unitPrice,
              },
            ],
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New invoice">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Patient">
          <select
            className={inputClassName}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setAppointmentId("");
            }}
            value={customerId}
          >
            {data.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Appointment (optional)">
          <select
            className={inputClassName}
            onChange={(event) => setAppointmentId(event.target.value)}
            value={appointmentId}
          >
            <option value="">Manual invoice</option>
            {customerAppointments.map((appointment) => (
              <option key={appointment.id} value={appointment.id}>
                {appointment.startsAtIso.slice(0, 10)} · {appointment.serviceIds.length} service(s)
              </option>
            ))}
          </select>
        </Field>

        {!appointmentId ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_100px_140px]">
            <Field label="Description">
              <input
                className={inputClassName}
                onChange={(event) => setDescription(event.target.value)}
                required
                value={description}
              />
            </Field>
            <Field label="Qty">
              <input
                className={inputClassName}
                min={1}
                onChange={(event) => setQuantity(Number(event.target.value))}
                type="number"
                value={quantity}
              />
            </Field>
            <Field label="Unit price">
              <input
                className={inputClassName}
                min={0}
                onChange={(event) => setUnitPrice(Number(event.target.value))}
                step="0.01"
                type="number"
                value={unitPrice}
              />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Due date">
            <input
              className={inputClassName}
              onChange={(event) => setDueDate(event.target.value)}
              type="date"
              value={dueDate}
            />
          </Field>
          <Field label="Notes">
            <textarea
              className={textareaClassName}
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Creating invoice" type="submit">
            Create invoice
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({
  invoice,
  onClose,
  onSubmit,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSubmit: (draft: PaymentDraft) => Promise<void>;
}) {
  const [amount, setAmount] = useState(invoice.balanceAmount);
  const [method, setMethod] = useState<PaymentDraft["method"]>("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit({
        amount,
        method,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`Record payment · ${invoice.invoiceNumber}`}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Amount">
            <input
              className={inputClassName}
              min={0.01}
              onChange={(event) => setAmount(Number(event.target.value))}
              step="0.01"
              type="number"
              value={amount}
            />
          </Field>
          <Field label="Method">
            <select
              className={inputClassName}
              onChange={(event) => setMethod(event.target.value as PaymentDraft["method"])}
              value={method}
            >
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="BankTransfer">Bank transfer</option>
              <option value="DigitalWallet">Digital wallet</option>
              <option value="Insurance">Insurance</option>
              <option value="Other">Other</option>
            </select>
          </Field>
        </div>

        <Field label="Reference">
          <input
            className={inputClassName}
            onChange={(event) => setReferenceNumber(event.target.value)}
            value={referenceNumber}
          />
        </Field>

        <Field label="Notes">
          <textarea
            className={textareaClassName}
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Recording payment" type="submit">
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceStatusBadge({ status }: { status: Invoice["status"] }) {
  const tones: Record<Invoice["status"], string> = {
    Draft: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
    Issued: "bg-[var(--surface-muted)] text-[var(--foreground)]",
    PartiallyPaid: "bg-[var(--surface-muted)] text-[var(--accent-strong)]",
    Paid: "bg-[var(--accent-soft)] text-[var(--brand-strong)]",
    Cancelled: "bg-[var(--danger-soft)] text-[var(--danger)]",
    Void: "bg-[var(--danger-soft)] text-[var(--danger)]",
  };

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tones[status]}`}>{status}</span>;
}

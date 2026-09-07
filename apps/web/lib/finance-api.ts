import { apiFetchJson } from "@/lib/api-client";
import type {
  CorrectionKind,
  FinanceCorrection,
  FinanceInvoiceDetail,
  FinanceLedgerEntry,
  FinanceReconciliation,
  FinanceWorkspaceData,
} from "@/lib/finance-domain";

type V1Envelope<T> = {
  data: T;
  meta: {
    apiVersion: "v1";
    requestId?: string;
    replayed?: boolean;
  };
};

function queryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

type ApiClient = { id: string; name: string; clientCode?: string | null };

type ApiInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  client: ApiClient;
  locationId?: string | null;
  status: FinanceInvoiceDetail["status"];
  issuedAtIso: string;
  dueAtIso?: string | null;
  totalNpr: string;
  balanceNpr: string;
  collectedNpr?: string;
  correctedNpr?: string;
  capabilities: FinanceWorkspaceData["capabilities"];
};

type ApiCorrection = {
  id: string;
  invoiceId: string;
  invoiceNumber?: string;
  paymentId: string;
  kind: CorrectionKind;
  amountNpr: string;
  reason: string;
  status: FinanceCorrection["status"];
  initiatedByUserId: string;
  initiatedBy?: { id: string; name: string } | null;
  requestedAtIso: string;
  version: number;
  canApprove?: boolean;
};

export type FinanceClientOption = {
  id: string;
  clientCode?: string | null;
  name: string;
  phone: string;
};

export type CreateFinanceInvoiceInput = {
  locationId: string;
  clientId: string;
  appointmentId?: string;
  dueAtIso?: string;
  notes?: string;
  lineItems: Array<{
    serviceId?: string;
    description: string;
    quantity: number;
    unitPriceNpr: string;
    discountNpr?: string;
    taxNpr?: string;
  }>;
};

export async function searchFinanceClients(
  query: string,
  signal?: AbortSignal,
) {
  const response = await apiFetchJson<
    V1Envelope<{ items: FinanceClientOption[] }>
  >(
    `/v1/clients${queryString({
      query: query.trim() || undefined,
      limit: "8",
    })}`,
    { cache: "no-store", signal },
  );
  return response.data.items;
}

export async function createFinanceInvoice(
  input: CreateFinanceInvoiceInput,
  idempotencyKey: string,
) {
  const response = await apiFetchJson<
    V1Envelope<{
      invoice: { id: string; invoiceNumber: string; status: "Draft" };
      replayed: boolean;
    }>
  >("/v1/finance/invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function issueFinanceInvoice(
  invoiceId: string,
  idempotencyKey: string,
) {
  const response = await apiFetchJson<
    V1Envelope<{
      invoice: { id: string; invoiceNumber: string; status: "Issued" };
      replayed: boolean;
    }>
  >(`/v1/finance/invoices/${encodeURIComponent(invoiceId)}/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: "{}",
  });
  return response.data;
}

export async function loadFinanceWorkspace(
  options: { locationId?: string; clientId?: string; signal?: AbortSignal } = {},
) {
  const response = await apiFetchJson<
    V1Envelope<
      Omit<FinanceWorkspaceData, "invoices"> & {
        invoices: ApiInvoiceSummary[];
      }
    >
  >(
    `/v1/finance/workspace${queryString({
      locationId: options.locationId,
      clientId: options.clientId,
    })}`,
    { cache: "no-store", signal: options.signal },
  );
  return {
    ...response.data,
    invoices: response.data.invoices.map((invoice) => ({
      ...invoice,
      clientId: invoice.client.id,
      clientName: invoice.client.name,
      clientCode: invoice.client.clientCode,
      paidNpr: invoice.collectedNpr ?? "0.00",
      correctedNpr: invoice.correctedNpr ?? "0.00",
    })),
  };
}

export async function loadFinanceInvoice(
  invoiceId: string,
  signal?: AbortSignal,
) {
  const response = await apiFetchJson<
    V1Envelope<{
      invoice: ApiInvoiceSummary & {
        currency: string;
        subtotalNpr: string;
        discountNpr: string;
        taxNpr: string;
        collectedNpr: string;
        correctedNpr: string;
        notes?: string | null;
        lineItems: Array<{
          id: string;
          description: string;
          quantity: number;
          unitPriceNpr: string;
          discountNpr: string;
          taxNpr: string;
          totalNpr: string;
        }>;
      };
      ledger: Array<
        Omit<FinanceLedgerEntry, "type"> & {
          type: string;
          correctionId?: string;
          kind?: CorrectionKind;
        }
      >;
    }>
  >(
    `/v1/finance/invoices/${encodeURIComponent(invoiceId)}`,
    { cache: "no-store", signal },
  );
  const { invoice, ledger } = response.data;
  return {
    ...invoice,
    clientId: invoice.client.id,
    clientName: invoice.client.name,
    clientCode: invoice.client.clientCode,
    paidNpr: invoice.collectedNpr,
    lineItems: invoice.lineItems.map((item) => ({
      ...item,
      lineTotalNpr: item.totalNpr,
    })),
    ledger: ledger.map((entry) => ({
      ...entry,
      type: normalizeLedgerType(entry.type, entry.status),
    })),
  };
}

export async function requestFinancialCorrection(params: {
  invoiceId: string;
  paymentId: string;
  idempotencyKey: string;
  kind: CorrectionKind;
  amountNpr: string;
  reason: string;
  providerReference?: string;
}) {
  const response = await apiFetchJson<
    V1Envelope<{ correction: ApiCorrection; replayed?: boolean }>
  >(
    `/v1/finance/invoices/${encodeURIComponent(params.invoiceId)}/payments/${encodeURIComponent(params.paymentId)}/corrections`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify({
        kind: params.kind,
        amountNpr: params.amountNpr,
        reason: params.reason,
        providerReference: params.providerReference || undefined,
      }),
    },
  );
  return {
    ...response.data,
    correction: normalizeCorrection(response.data.correction),
  };
}

export async function recordFinancePayment(params: {
  invoiceId: string;
  locationId: string;
  amountNpr: string;
  method: string;
  paidAtIso: string;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey: string;
}) {
  const response = await apiFetchJson<
    V1Envelope<{
      payment: {
        id: string;
        invoiceId: string;
        amountNpr: string;
        status: string;
        paidAtIso: string;
      };
      replayed: boolean;
    }>
  >(
    `/v1/finance/invoices/${encodeURIComponent(params.invoiceId)}/payments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify({
        locationId: params.locationId,
        amountNpr: params.amountNpr,
        method: params.method,
        paidAtIso: params.paidAtIso,
        referenceNumber: params.referenceNumber || undefined,
        notes: params.notes || undefined,
      }),
    },
  );
  return response.data;
}

export async function loadPendingFinanceCorrections(signal?: AbortSignal) {
  const response = await apiFetchJson<
    V1Envelope<{ items: ApiCorrection[] }>
  >("/v1/finance/corrections?status=PendingApproval", {
    cache: "no-store",
    signal,
  });
  return response.data.items.map(normalizeCorrection);
}

export async function approveFinanceCorrection(params: {
  correctionId: string;
  expectedVersion: number;
}) {
  const response = await apiFetchJson<V1Envelope<{ correction: ApiCorrection }>>(
    `/v1/finance/corrections/${encodeURIComponent(params.correctionId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: params.expectedVersion }),
    },
  );
  return normalizeCorrection(response.data.correction);
}

export async function rejectFinanceCorrection(params: {
  correctionId: string;
  expectedVersion: number;
  reason: string;
}) {
  const response = await apiFetchJson<V1Envelope<{ correction: ApiCorrection }>>(
    `/v1/finance/corrections/${encodeURIComponent(params.correctionId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: params.expectedVersion,
        reason: params.reason,
      }),
    },
  );
  return normalizeCorrection(response.data.correction);
}

export async function loadFinanceReconciliation(params: {
  date: string;
  locationId?: string;
  signal?: AbortSignal;
}) {
  const response = await apiFetchJson<
    V1Envelope<{
      date: string;
      totals: {
        issuedNpr: string;
        collectedNpr: string;
        correctedNpr: string;
        outstandingNpr: string;
        pendingApprovalCount: number;
      };
      byMethod: Array<{ method: string; collectedNpr: string; count: number }>;
      exceptions: Array<{
        id: string;
        type: string;
        severity: string;
        invoiceNumber?: string | null;
        message: string;
      }>;
    }>
  >(
    `/v1/finance/reconciliation${queryString({
      date: params.date,
      locationId: params.locationId,
    })}`,
    { cache: "no-store", signal: params.signal },
  );
  return {
    date: response.data.date,
    totals: response.data.totals,
    byMethod: response.data.byMethod.map((item) => ({
      method: item.method,
      amountNpr: item.collectedNpr,
      paymentCount: item.count,
    })),
    pendingApprovals: response.data.totals.pendingApprovalCount,
    exceptions: response.data.exceptions.map((item) => ({
      id: item.id,
      kind: `${item.type} · ${item.severity}`,
      status: "Open",
      summary: item.message,
      invoiceNumber: item.invoiceNumber,
    })),
  } satisfies FinanceReconciliation;
}

function normalizeCorrection(correction: ApiCorrection): FinanceCorrection {
  return {
    id: correction.id,
    invoiceId: correction.invoiceId,
    invoiceNumber: correction.invoiceNumber ?? "Invoice",
    paymentId: correction.paymentId,
    clientName: null,
    kind: correction.kind,
    amountNpr: correction.amountNpr,
    reason: correction.reason,
    status: correction.status,
    initiatedByUserId: correction.initiatedByUserId,
    initiatedByName: correction.initiatedBy?.name,
    initiatedAtIso: correction.requestedAtIso,
    version: correction.version,
    canApprove: correction.canApprove,
    approvalBlockedReason:
      correction.canApprove === false
        ? "You cannot approve this correction. Self-approval is prohibited."
        : undefined,
  };
}

function normalizeLedgerType(type: string, status?: string) {
  const labels: Record<string, FinanceLedgerEntry["type"]> = {
    invoice_issued: "InvoiceIssued",
    payment: "PaymentCompleted",
    payment_completed: "PaymentCompleted",
    correction_requested: "CorrectionRequested",
    correction_approved: "CorrectionApproved",
    correction_rejected: "CorrectionRejected",
    correction_executed: "CorrectionExecuted",
  };
  if (type === "correction") {
    const correctionLabels: Record<string, FinanceLedgerEntry["type"]> = {
      PendingApproval: "CorrectionRequested",
      Approved: "CorrectionApproved",
      Rejected: "CorrectionRejected",
      Executed: "CorrectionExecuted",
    };
    return correctionLabels[status ?? ""] ?? "CorrectionRequested";
  }
  return labels[type] ?? type;
}

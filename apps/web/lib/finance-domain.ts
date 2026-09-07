export type MoneyNpr = string;

export type FinanceCapabilities = {
  canCreateDraft: boolean;
  canIssue: boolean;
  canRecordPayment: boolean;
  canInitiateCorrection: boolean;
  canApproveCorrection: boolean;
  canReconcile: boolean;
};

export type FinanceInvoiceStatus =
  | "Draft"
  | "Issued"
  | "PartiallyPaid"
  | "Paid"
  | "Cancelled"
  | "Void";

export type FinanceInvoiceRow = {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  clientCode?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  status: FinanceInvoiceStatus;
  issuedAtIso: string;
  dueAtIso?: string | null;
  totalNpr: MoneyNpr;
  paidNpr: MoneyNpr;
  correctedNpr: MoneyNpr;
  balanceNpr: MoneyNpr;
  permittedActions?: string[];
  capabilities: FinanceCapabilities;
};

export type FinanceWorkspaceData = {
  capabilities: FinanceCapabilities;
  createLocationIds: string[] | null;
  summary: {
    issuedNpr: MoneyNpr;
    collectedNpr: MoneyNpr;
    correctedNpr: MoneyNpr;
    outstandingNpr: MoneyNpr;
    pendingApprovalCount: number;
  };
  invoices: FinanceInvoiceRow[];
};

export type FinanceLedgerEntryType =
  | "InvoiceDrafted"
  | "InvoiceIssued"
  | "PaymentCompleted"
  | "CorrectionRequested"
  | "CorrectionApproved"
  | "CorrectionRejected"
  | "CorrectionExecuted"
  | "InvoiceVoided"
  | string;

export type FinanceLedgerEntry = {
  id: string;
  type: FinanceLedgerEntryType;
  occurredAtIso: string;
  amountNpr: MoneyNpr;
  status: string;
  method?: string | null;
  reference?: string | null;
  reason?: string | null;
  actorId?: string | null;
  paymentId?: string | null;
  correctableNpr?: MoneyNpr;
};

export type FinanceInvoiceDetail = FinanceInvoiceRow & {
  notes?: string | null;
  subtotalNpr: MoneyNpr;
  discountNpr: MoneyNpr;
  taxNpr: MoneyNpr;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPriceNpr: MoneyNpr;
    discountNpr: MoneyNpr;
    taxNpr: MoneyNpr;
    lineTotalNpr: MoneyNpr;
  }>;
  ledger: FinanceLedgerEntry[];
};

export type CorrectionKind = "Refund" | "Reversal";
export type CorrectionStatus =
  | "PendingApproval"
  | "Approved"
  | "Rejected"
  | "Executed";

export type FinanceCorrection = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  clientName?: string | null;
  kind: CorrectionKind;
  amountNpr: MoneyNpr;
  reason: string;
  status: CorrectionStatus;
  initiatedByUserId: string;
  initiatedByName?: string | null;
  initiatedAtIso: string;
  version: number;
  canApprove?: boolean;
  approvalBlockedReason?: string | null;
};

export type ReconciliationException = {
  id: string;
  kind: string;
  status: "Open" | "InReview" | "Resolved" | "Dismissed" | string;
  summary: string;
  amountNpr?: MoneyNpr | null;
  invoiceNumber?: string | null;
  reference?: string | null;
  occurredAtIso?: string | null;
};

export type FinanceReconciliation = {
  date: string;
  totals: {
    issuedNpr: MoneyNpr;
    collectedNpr: MoneyNpr;
    correctedNpr: MoneyNpr;
    outstandingNpr: MoneyNpr;
    cashExpectedNpr?: MoneyNpr;
  };
  byMethod: Array<{
    method: string;
    amountNpr: MoneyNpr;
    paymentCount: number;
  }>;
  pendingApprovals: number;
  exceptions: ReconciliationException[];
};

export function formatNpr(value: MoneyNpr | number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "NPR —";
  return `NPR ${new Intl.NumberFormat("en-NP", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)}`;
}

export function isPositiveMoney(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim()) &&
    Number(value) > 0;
}

export function maskFinanceReference(value?: string | null) {
  const reference = value?.trim();
  if (!reference) return "Not recorded";
  if (reference.length <= 6) return reference;
  return `${reference.slice(0, 3)}•••${reference.slice(-3)}`;
}

export function requiresPaymentReference(method: string) {
  return method !== "Cash";
}

export function canRecordPaymentForStatus(status: FinanceInvoiceStatus) {
  return status === "Issued" || status === "PartiallyPaid";
}

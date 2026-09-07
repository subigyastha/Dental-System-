import type { CalendarMode } from "@/lib/calendar";

export type { CalendarMode } from "@/lib/calendar";

export type AppointmentStatus =
  | "Scheduled"
  | "Confirmed"
  | "CheckedIn"
  | "InProgress"
  | "Completed"
  | "Cancelled"
  | "NoShow"
  | "Rescheduled"
  | "FollowUpRequired";

export type Priority = "Low" | "Normal" | "High" | "Urgent";

export type FollowUpType =
  | "Reminder"
  | "NoShowRecovery"
  | "Recall"
  | "IncompleteWorkflow"
  | "TreatmentContinuation";

export type FollowUpStatus = "Open" | "InProgress" | "Waiting" | "Done" | "Blocked";

export type Provider = {
  id: string;
  userId?: string;
  name: string;
  roleLabel: string;
  specialty: string;
  color: string;
  capacityMinutes: number;
  bookedMinutes: number;
  status: "Available" | "Busy" | "Away" | "Inactive";
  availability: ProviderAvailability[];
  recurringBlocks: ProviderRecurringBlock[];
  blockedTimes: ScheduleBlock[];
  serviceIds: string[];
};

export type ProviderAvailability = {
  id: string;
  providerId: string;
  locationId?: string;
  dayOfWeek: number;
  startsAtLocal: string;
  endsAtLocal: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
};

export type ScheduleBlock = {
  id: string;
  providerId?: string;
  locationId?: string;
  startsAtIso: string;
  endsAtIso: string;
  reason: string;
};

export type ProviderRecurringBlock = {
  id: string;
  providerId: string;
  locationId?: string;
  dayOfWeek: number;
  startsAtLocal: string;
  endsAtLocal: string;
  reason: string;
  isActive: boolean;
};

export type DentalChart = {
  id: string;
  chartData: unknown;
  version: number;
  updatedAtIso: string;
};

export type DentalChartRevision = {
  id: string;
  chartData: unknown;
  note?: string;
  createdAtIso: string;
};

export type Customer = {
  id: string;
  organizationId?: string;
  name: string;
  patientCode?: string;
  phone: string;
  email?: string;
  age: number;
  gender?: string;
  address?: string;
  dateOfBirthIso?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  allergies?: string;
  medicalNotes?: string;
  status?: "Active" | "Monitoring" | "Archived";
  risk: "Routine" | "Needs attention" | "High priority";
  lastVisitIso: string;
  dentalChart?: DentalChart;
};

export type CustomerMatchConfidence = "strong" | "moderate" | "weak";

export type CustomerMatch = {
  confidence: CustomerMatchConfidence;
  customer: Customer;
};

export type VisitReport = {
  id: string;
  appointmentId: string;
  customerId: string;
  providerId: string;
  serviceId: string;
  appointmentStartsAtIso: string;
  createdAtIso: string;
  updatedAtIso: string;
  visitSummary: string;
  symptoms?: string;
  clinicalNotes?: string;
  doctorNotes?: string;
  followUpRequired: boolean;
  followUpDateIso?: string;
  dentalChartUpdated: boolean;
  chartNote?: string;
  dentalChartRevision?: DentalChartRevision;
};

export type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  category: string;
};

export type Appointment = {
  id: string;
  organizationId: string;
  customerId: string;
  providerId: string;
  serviceIds: string[];
  startsAtIso: string;
  durationMinutes: number;
  bufferMinutes: number;
  status: AppointmentStatus;
  priority: Priority;
  chair: string;
  notes: string;
  communicationState: "Unconfirmed" | "Confirmed by phone" | "SMS sent" | "Needs call";
  /** Directory-safe labels returned with bounded schedule range reads. */
  clientSummary?: {
    id: string;
    name: string;
    patientCode?: string;
  };
  providerSummary?: {
    id: string;
    name: string;
    color: string;
    specialty?: string;
  };
  serviceSummaries?: Service[];
};

export type AppointmentDaySummary = {
  dateKey: string;
  appointmentCount: number;
  providerMarkers: Array<{
    providerId: string;
    color: string;
    count: number;
  }>;
  hasAvailability: boolean;
};

export type ProviderDayScheduleSlotState =
  | "AVAILABLE"
  | "BOOKED"
  | "BLOCKED"
  | "UNAVAILABLE";

export type ProviderDayScheduleGrid = {
  date: string;
  timezone: string;
  providers: Array<{
    providerId: string;
    providerName: string;
    providerColor: string;
    specialty: string;
    slots: Array<{
      startTime: string;
      endTime: string;
      state: ProviderDayScheduleSlotState;
      appointmentId?: string;
      appointmentSummary?: {
        customerName: string;
        serviceName: string;
        status: AppointmentStatus;
      };
    }>;
  }>;
};

export type AppointmentWeekSummary = {
  dateKey: string;
  totalAppointments: number;
  statusCounts: Record<string, number>;
  hasAvailability: boolean;
  providers: Array<{
    providerId: string;
    name: string;
    color: string;
    appointmentCount: number;
    loadPercent: number;
    hasOpenCapacity: boolean;
  }>;
};

export type ProviderSlot = {
  startsAtIso: string;
  time: string;
  timeLabel: string;
  dateKey: string;
};

export type ProviderSlotResponse = {
  providerId: string;
  dateKey: string;
  durationMinutes: number;
  bufferMinutes: number;
  slots: ProviderSlot[];
};

export type AppointmentWeekSummaryResponse = {
  days: AppointmentWeekSummary[];
};

export type FollowUpTask = {
  id: string;
  appointmentId?: string;
  customerId: string;
  ownerId: string;
  type: FollowUpType;
  status: FollowUpStatus;
  priority: Priority;
  dueIso: string;
  summary: string;
  nextAction: string;
};

export type CommunicationEntry = {
  id: string;
  appointmentId?: string;
  customerId: string;
  channel: "Phone" | "SMS" | "WhatsApp" | "Email" | "InPerson";
  direction: "Inbound" | "Outbound";
  summary: string;
  occurredAtIso: string;
};

export type OperationalMetric = {
  label: string;
  value: string;
  context: string;
  tone: "neutral" | "good" | "warning" | "danger";
};

export type Organization = {
  id: string;
  name: string;
  businessType?: string;
  email?: string;
  phone?: string;
  address?: string;
  timezone: string;
  primaryCalendar: CalendarMode;
  businessDayStartsAt?: string;
  businessDayEndsAt?: string;
  defaultBufferMinutes?: number;
  reminderLeadMinutes?: number;
  allowOverlaps?: boolean;
};

export type Location = {
  id: string;
  organizationId: string;
  name: string;
  address?: string;
  phone?: string;
  timezone: string;
  isActive: boolean;
};

export type WorkspaceUserRole =
  | "SuperAdmin"
  | "Owner"
  | "Admin"
  | "Manager"
  | "Receptionist"
  | "Scheduler"
  | "Provider"
  | "Assistant"
  | "Finance"
  | "InventoryManager"
  | "Client";

export type SessionUser = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: WorkspaceUserRole;
  /** The server-authoritative union of active role assignments. */
  effectiveRoles?: WorkspaceUserRole[];
  providerId?: string;
};

export type StaffRole = SessionUser["role"];

export type StaffMember = {
  id: string;
  organizationId: string;
  providerId?: string;
  name: string;
  email: string;
  phone?: string;
  role: StaffRole;
  staffLabel: string;
  department?: string;
  employeeCode?: string;
  licenseNumber?: string;
  employmentType?: string;
  startDateIso?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  status: "Active" | "Inactive" | "Invited" | "Suspended";
  isSchedulable: boolean;
  provider?: Provider;
  lastLoginAtIso?: string;
};

export type InvoiceStatus =
  | "Draft"
  | "Issued"
  | "PartiallyPaid"
  | "Paid"
  | "Cancelled"
  | "Void";

export type PaymentMethod =
  | "Cash"
  | "Card"
  | "BankTransfer"
  | "DigitalWallet"
  | "Insurance"
  | "Other";

export type PaymentStatus = "Pending" | "Completed" | "Failed" | "Refunded" | "Cancelled";

export type InvoiceLineItem = {
  id: string;
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  sortOrder: number;
};

export type PaymentRecord = {
  id: string;
  organizationId: string;
  invoiceId: string;
  customerId: string;
  appointmentId?: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  referenceNumber?: string;
  paidAtIso: string;
  notes?: string;
  createdAtIso: string;
  updatedAtIso: string;
};

export type Invoice = {
  id: string;
  organizationId: string;
  customerId: string;
  appointmentId?: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAtIso: string;
  dueAtIso?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  balanceAmount: number;
  notes?: string;
  lineItems: InvoiceLineItem[];
  payments: PaymentRecord[];
  createdAtIso: string;
  updatedAtIso: string;
};

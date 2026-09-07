"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { apiFetchJson, withSessionRequest as withAuthHeaders } from "@/lib/api-client";
import {
  createBookingBootstrapLoader,
  type BookingBootstrap,
  type BookingBootstrapEnvelope,
} from "@/lib/booking-bootstrap";
import type { OperationalData } from "@/lib/database-data";
import {
  scheduleOperationalData,
  unwrapScheduleBootstrap,
  type ScheduleBootstrap,
} from "@/lib/schedule-bootstrap";
import type { WorkspaceBootstrap } from "@/lib/workspace-bootstrap";
import { logoutCurrentSession } from "@/lib/session-lifecycle";
import { publishSessionEnd } from "@/lib/session-events";
import { clearWorkspaceSessionCache } from "@/lib/workspace-session-loader";
import type {
  Appointment,
  AppointmentDaySummary,
  AppointmentWeekSummary,
  AppointmentWeekSummaryResponse,
  CalendarMode,
  Customer,
  CustomerMatch,
  Invoice,
  PaymentMethod,
  PaymentStatus,
  ProviderDayScheduleGrid,
  ProviderSlotResponse,
  SessionUser,
  StaffMember,
} from "@/lib/domain";

type ToastState = {
  id: number;
  message: string;
} | null;

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

const MAX_PLANNING_CACHE_ENTRIES = 32;

function readPlanningCache<Value>(cache: Map<string, Value>, key: string) {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function writePlanningCache<Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value,
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_PLANNING_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

/**
 * A component may stop waiting when it unmounts, but that should not cancel a
 * shared HTTP request that another Strict Mode render or route consumer can
 * reuse. This keeps cancellation local while preserving request single-flight.
 */
function waitForPlanningRequest<Value>(
  request: Promise<Value>,
  signal?: AbortSignal,
) {
  if (!signal) return request;
  if (signal.aborted) {
    return Promise.reject(new DOMException("The request was aborted", "AbortError"));
  }
  return new Promise<Value>((resolve, reject) => {
    const abort = () => reject(new DOMException("The request was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export type CustomerDraft = {
  name: string;
  patientCode?: string;
  phone: string;
  email?: string;
  gender?: string;
  dateOfBirthIso?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  allergies?: string;
  medicalNotes?: string;
  risk: Customer["risk"];
};

export type ResolveCustomerDraft = CustomerDraft & {
  mode: "use_existing" | "update_existing" | "create_new";
  existingCustomerId?: string;
  priorVisitedClinic?: boolean;
  duplicateCheckAcknowledged?: boolean;
  skippedPossibleMatchClientIds?: string[];
};

export type AppointmentDraft = {
  holdId?: string;
  locationId?: string;
  customerId: string;
  providerId: string;
  resourceId?: string;
  serviceIds: string[];
  startsAtIso: string;
  durationMinutes: number;
  bufferMinutes: number;
  priority: "Low" | "Normal" | "High" | "Urgent";
  chair?: string;
  notes?: string;
};

export type VisitReportDraft = {
  appointmentId: string;
  providerId: string;
  serviceId: string;
  visitSummary: string;
  symptoms?: string;
  clinicalNotes?: string;
  doctorNotes?: string;
  followUpRequired: boolean;
  followUpDateIso?: string;
  updateDentalChart: boolean;
  chartData?: Record<string, unknown>;
  chartNote?: string;
};

export type StaffDraft = {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  role: StaffMember["role"];
  staffLabel: string;
  department?: string;
  employeeCode?: string;
  licenseNumber?: string;
  employmentType?: string;
  startDateIso?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  status: StaffMember["status"];
  isSchedulable: boolean;
  specialty?: string;
  color?: string;
  providerStatus?: "Available" | "Busy" | "Away" | "Inactive";
  password?: string;
};

export type AvailabilityDraft = {
  id?: string;
  locationId?: string;
  dayOfWeek: number;
  startsAtLocal: string;
  endsAtLocal: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
};

export type BlockedTimeDraft = {
  id?: string;
  locationId?: string;
  startsAtIso: string;
  endsAtIso: string;
  reason: string;
};

export type RecurringBlockDraft = {
  id?: string;
  locationId?: string;
  dayOfWeek: number;
  startsAtLocal: string;
  endsAtLocal: string;
  reason: string;
  isActive: boolean;
};

export type InvoiceDraft = {
  customerId: string;
  appointmentId?: string;
  dueAtIso?: string;
  notes?: string;
  lineItems: Array<{
    serviceId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountAmount?: number;
    taxAmount?: number;
    sortOrder?: number;
  }>;
};

export type PaymentDraft = {
  amount: number;
  method: PaymentMethod;
  status?: PaymentStatus;
  paidAtIso?: string;
  referenceNumber?: string;
  notes?: string;
};

export type ScheduleDaySnapshot = {
  appointments: Appointment[];
  grid: ProviderDayScheduleGrid;
};

type WorkspaceContextValue = {
  data: OperationalData;
  workspaceBootstrap: WorkspaceBootstrap;
  planningRevision: number;
  calendarMode: CalendarMode;
  setCalendarMode: (mode: CalendarMode) => void;
  selectedDate: string;
  setSelectedDate: (dateKey: string) => void;
  sessionUser: SessionUser | null;
  isAuthenticating: boolean;
  toast: ToastState;
  clearToast: () => void;
  isLoggingOut: boolean;
  logoutError: string | null;
  clearLogoutError: () => void;
  logout: () => Promise<void>;
  refreshOperationalData: () => Promise<void>;
  invalidatePlanningCaches: (params?: {
    providerIds?: string[];
    dateKeys?: string[];
  }) => void;
  loadBookingBootstrap: (locationId: string) => Promise<BookingBootstrap>;
  applyConfirmedBooking: (result: {
    appointmentId: string;
    providerId: string;
    dateKey: string;
    clientId: string;
  }) => void;
  createAppointment: (draft: AppointmentDraft) => Promise<void>;
  updateAppointment: (appointmentId: string, draft: AppointmentDraft) => Promise<void>;
  rescheduleAppointment: (appointmentId: string, draft: AppointmentDraft, reason: string) => Promise<void>;
  deleteAppointment: (appointmentId: string) => Promise<void>;
  updateAppointmentStatus: (
    appointmentId: string,
    status: string,
    note?: string,
  ) => Promise<void>;
  createCustomer: (draft: CustomerDraft) => Promise<void>;
  matchCustomers: (draft: Pick<CustomerDraft, "name" | "phone" | "email">) => Promise<CustomerMatch[]>;
  resolveCustomerForAppointment: (draft: ResolveCustomerDraft) => Promise<Customer>;
  mergeCustomers: (primaryCustomerId: string, secondaryCustomerId: string) => Promise<Customer>;
  updateCustomer: (customerId: string, draft: CustomerDraft) => Promise<void>;
  deleteCustomer: (customerId: string) => Promise<void>;
  createVisitReport: (customerId: string, draft: VisitReportDraft) => Promise<void>;
  createStaff: (draft: StaffDraft) => Promise<void>;
  updateStaff: (staffId: string, draft: StaffDraft) => Promise<void>;
  resetStaffPassword: (staffId: string, password: string) => Promise<void>;
  deactivateStaff: (staffId: string) => Promise<void>;
  restoreStaff: (staffId: string) => Promise<void>;
  updateProviderSchedule: (
    providerId: string,
    availability: AvailabilityDraft[],
    recurringBlocks: RecurringBlockDraft[],
    blockedTimes: BlockedTimeDraft[],
  ) => Promise<void>;
  fetchAppointmentsRange: (params: {
    fromIso: string;
    toIso: string;
    providerId?: string;
    locationId?: string;
    signal?: AbortSignal;
  }) => Promise<Appointment[]>;
  fetchAppointmentDaySummaries: (params: {
    fromDateKey: string;
    toDateKey: string;
    providerId?: string;
    locationId?: string;
    signal?: AbortSignal;
  }) => Promise<AppointmentDaySummary[]>;
  fetchWeekOperationalSummaries: (params: {
    fromDateKey: string;
    toDateKey: string;
    providerId?: string;
    locationId?: string;
    signal?: AbortSignal;
  }) => Promise<AppointmentWeekSummary[]>;
  fetchScheduleGridForDay: (params: {
    providerIds?: string[];
    date: string;
    locationId?: string;
  }) => Promise<ProviderDayScheduleGrid>;
  fetchScheduleDay: (params: {
    providerIds?: string[];
    date: string;
    locationId?: string;
    signal?: AbortSignal;
  }) => Promise<ScheduleDaySnapshot>;
  fetchProviderSlotsForBooking: (params: {
    providerId: string;
    date: string;
    locationId?: string;
    serviceId?: string;
    durationMinutes?: number;
    excludeAppointmentId?: string;
  }) => Promise<ProviderSlotResponse>;
  updateOrganization: (draft: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    primaryCalendar: CalendarMode;
    businessDayStartsAt: string;
    businessDayEndsAt: string;
    defaultBufferMinutes: number;
    reminderLeadMinutes: number;
    allowOverlaps: boolean;
  }) => Promise<void>;
  invoices: Invoice[];
  invoicesLoaded: boolean;
  invoicesLoading: boolean;
  loadInvoices: (customerId?: string) => Promise<void>;
  createInvoice: (draft: InvoiceDraft) => Promise<void>;
  issueInvoice: (invoiceId: string) => Promise<void>;
  recordPayment: (invoiceId: string, draft: PaymentDraft) => Promise<void>;
  deleteInvoice: (invoiceId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  children,
  initialData,
  initialSessionUser,
  initialWorkspaceBootstrap,
  todayDateKey,
}: {
  children: ReactNode;
  initialData: OperationalData;
  initialSessionUser: SessionUser;
  initialWorkspaceBootstrap: WorkspaceBootstrap;
  todayDateKey: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>(
    initialData.organization.primaryCalendar,
  );
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(
    initialSessionUser,
  );
  const [authToken, setAuthToken] = useState<string | null>("cookie-session");
  const isAuthenticating = false;
  const [toast, setToast] = useState<ToastState>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [planningRevision, setPlanningRevision] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutRequest = useRef<Promise<void> | null>(null);
  const planningCacheRevision = useRef(0);
  const [slotCache] = useState(() => new Map<string, ProviderSlotResponse>());
  const [slotRequests] = useState(() => new Map<string, Promise<ProviderSlotResponse>>());
  const [appointmentRangeCache] = useState(() => new Map<string, Appointment[]>());
  const [appointmentRangeRequests] = useState(() => new Map<string, Promise<Appointment[]>>());
  const [daySummaryCache] = useState(() => new Map<string, AppointmentDaySummary[]>());
  const [daySummaryRequests] = useState(() => new Map<string, Promise<AppointmentDaySummary[]>>());
  const [weekSummaryCache] = useState(() => new Map<string, AppointmentWeekSummary[]>());
  const [weekSummaryRequests] = useState(() => new Map<string, Promise<AppointmentWeekSummary[]>>());
  const [scheduleGridCache] = useState(() => new Map<string, ProviderDayScheduleGrid>());
  const [scheduleGridRequests] = useState(() => new Map<string, Promise<ProviderDayScheduleGrid>>());
  const [scheduleDayCache] = useState(() => new Map<string, ScheduleDaySnapshot>());
  const [scheduleDayRequests] = useState(() => new Map<string, Promise<ScheduleDaySnapshot>>());
  const [bookingBootstrapLoader] = useState(() =>
    createBookingBootstrapLoader((locationId) =>
      apiFetchJson<BookingBootstrapEnvelope>(
        `/v1/booking/bootstrap?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store" },
      ),
    ),
  );

  const notify = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    setData(initialData);
    setCalendarMode(initialData.organization.primaryCalendar);
  }, [initialData]);

  useEffect(() => {
    setSessionUser(initialSessionUser);
  }, [initialSessionUser]);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const invalidatePlanningCaches = useCallback((params?: {
    providerIds?: string[];
    dateKeys?: string[];
  }) => {
    planningCacheRevision.current += 1;
    appointmentRangeCache.clear();
    appointmentRangeRequests.clear();
    daySummaryCache.clear();
    daySummaryRequests.clear();
    weekSummaryCache.clear();
    weekSummaryRequests.clear();
    slotRequests.clear();
    scheduleGridRequests.clear();
    scheduleDayRequests.clear();

    const providerIds = params?.providerIds ? new Set(params.providerIds) : null;
    const dateKeys = params?.dateKeys ? new Set(params.dateKeys) : null;

    for (const key of slotCache.keys()) {
      const [, providerId, dateKey] = key.split("|", 4);
      if (providerIds && !providerIds.has(providerId)) {
        continue;
      }
      if (dateKeys && !dateKeys.has(dateKey)) {
        continue;
      }
      slotCache.delete(key);
    }

    for (const key of scheduleGridCache.keys()) {
      const [, dateKey, providerValue] = key.split("|", 4);
      if (dateKeys && !dateKeys.has(dateKey)) {
        continue;
      }
      if (providerIds) {
        const providerList =
          providerValue === "providers:all" ? [] : providerValue.split(",").filter(Boolean);
        if (providerList.length && !providerList.some((providerId) => providerIds.has(providerId))) {
          continue;
        }
      }
      scheduleGridCache.delete(key);
    }

    for (const key of scheduleDayCache.keys()) {
      const [, dateKey, providerValue] = key.split("|", 4);
      if (dateKeys && !dateKeys.has(dateKey)) continue;
      if (providerIds) {
        const providerList =
          providerValue === "providers:all" ? [] : providerValue.split(",").filter(Boolean);
        if (providerList.length && !providerList.some((providerId) => providerIds.has(providerId))) {
          continue;
        }
      }
      scheduleDayCache.delete(key);
    }

    setPlanningRevision((current) => current + 1);
  }, [appointmentRangeCache, appointmentRangeRequests, daySummaryCache, daySummaryRequests, scheduleDayCache, scheduleDayRequests, scheduleGridCache, scheduleGridRequests, slotCache, slotRequests, weekSummaryCache, weekSummaryRequests]);

  const requireToken = useCallback(() => {
    if (!authToken) {
      throw new Error("Please sign in again.");
    }

    return authToken;
  }, [authToken]);

  const refreshOperationalData = useCallback(async () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("clinicflow:route-data-stale"));
    }
  }, []);

  const refreshScheduleData = useCallback(async () => {
    const response = await apiFetchJson<{
      data: ScheduleBootstrap;
      meta: { apiVersion: "v1"; requestId?: string };
    }>("/v1/schedule/bootstrap", withAuthHeaders(authToken, { cache: "no-store" }));
    setData(
      scheduleOperationalData(
        initialWorkspaceBootstrap,
        unwrapScheduleBootstrap(response),
      ),
    );
  }, [authToken, initialWorkspaceBootstrap]);

  const mergeAppointmentIntoData = useCallback((appointment: Appointment) => {
    setData((current) => {
      const nextAppointments = current.appointments.some((item) => item.id === appointment.id)
        ? current.appointments.map((item) => (item.id === appointment.id ? appointment : item))
        : [...current.appointments, appointment];

      nextAppointments.sort(
        (left, right) =>
          new Date(left.startsAtIso).getTime() - new Date(right.startsAtIso).getTime(),
      );

      return {
        ...current,
        appointments: nextAppointments,
      };
    });
  }, []);

  const removeAppointmentFromData = useCallback((appointmentId: string) => {
    setData((current) => ({
      ...current,
      appointments: current.appointments.filter((appointment) => appointment.id !== appointmentId),
    }));
  }, []);

  const mergeCustomerIntoData = useCallback((customer: Customer) => {
    setData((current) => ({
      ...current,
      customers: current.customers.some((item) => item.id === customer.id)
        ? current.customers.map((item) =>
            item.id === customer.id ? customer : item,
          )
        : [...current.customers, customer],
    }));
  }, []);

  const fetchAppointmentById = useCallback(async (appointmentId: string, token: string) => {
    return apiFetchJson<Appointment>(
      `/appointments/${appointmentId}`,
      withAuthHeaders(token, { cache: "no-store" }),
    );
  }, []);

  const clearLogoutError = useCallback(() => setLogoutError(null), []);

  const logout = useCallback(() => {
    if (logoutRequest.current) {
      return logoutRequest.current;
    }

    setLogoutError(null);
    setIsLoggingOut(true);
    const request = (async () => {
      try {
        const reason = await logoutCurrentSession();
        planningCacheRevision.current += 1;
        appointmentRangeCache.clear();
        appointmentRangeRequests.clear();
        daySummaryCache.clear();
        daySummaryRequests.clear();
        weekSummaryCache.clear();
        weekSummaryRequests.clear();
        scheduleGridCache.clear();
        scheduleGridRequests.clear();
        scheduleDayCache.clear();
        scheduleDayRequests.clear();
        slotCache.clear();
        slotRequests.clear();
        bookingBootstrapLoader.clear();
        setInvoices([]);
        setInvoicesLoaded(false);
        setInvoicesLoading(false);
        setAuthToken(null);
        setSessionUser(null);
        clearWorkspaceSessionCache();
        if (reason === "signed-out") {
          publishSessionEnd(reason);
        }
        router.replace("/login");
      } catch {
        setLogoutError(
          "We could not sign you out because the server could not confirm session revocation. Check your connection and try again.",
        );
      } finally {
        logoutRequest.current = null;
        setIsLoggingOut(false);
      }
    })();
    logoutRequest.current = request;
    return request;
  }, [appointmentRangeCache, appointmentRangeRequests, bookingBootstrapLoader, daySummaryCache, daySummaryRequests, router, scheduleDayCache, scheduleDayRequests, scheduleGridCache, scheduleGridRequests, slotCache, slotRequests, weekSummaryCache, weekSummaryRequests]);

  const loadInvoicesInternal = useCallback(async (token: string, customerId?: string) => {
    setInvoicesLoading(true);
    try {
      const query = customerId
        ? `?customerId=${encodeURIComponent(customerId)}`
        : "";
      const nextInvoices = await apiFetchJson<Invoice[]>(
        `/billing/invoices${query}`,
        withAuthHeaders(token, {
          cache: "no-store",
        }),
      );
      setInvoices(nextInvoices);
      setInvoicesLoaded(true);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  const runMutation = useCallback(
    async (
      path: string,
      init: RequestInit,
      successMessage: string,
      refresh: "operational" | "schedule" | "billing" | "both" | "none" = "operational",
    ) => {
      const token = requireToken();
      await apiFetchJson(path, withAuthHeaders(token, init));
      slotCache.clear();

      if (refresh === "operational" || refresh === "both") {
        await refreshOperationalData();
      }

      if (refresh === "schedule") {
        await refreshScheduleData();
      }

      if (refresh === "billing" || refresh === "both") {
        await loadInvoicesInternal(token);
      }

      notify(successMessage);
    },
    [loadInvoicesInternal, notify, refreshOperationalData, refreshScheduleData, requireToken, slotCache],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      workspaceBootstrap: initialWorkspaceBootstrap,
      planningRevision,
      calendarMode,
      setCalendarMode,
      selectedDate,
      setSelectedDate,
      sessionUser,
      isAuthenticating,
      toast,
      clearToast,
      isLoggingOut,
      logoutError,
      clearLogoutError,
      logout,
      refreshOperationalData,
      invalidatePlanningCaches,
      loadBookingBootstrap: (locationId) =>
        bookingBootstrapLoader.load(locationId),
      applyConfirmedBooking: (result) => {
        invalidatePlanningCaches({
          providerIds: [result.providerId],
          dateKeys: [result.dateKey],
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("clinicflow:booking-completed", {
              detail: result,
            }),
          );
          window.dispatchEvent(
            new CustomEvent("clinicflow:client-changed", {
              detail: { clientId: result.clientId },
            }),
          );
        }
        notify("Appointment booked");
      },
      createAppointment: async (draft) => {
        const token = requireToken();
        const response = await apiFetchJson<{ id: string }>(
          "/appointments",
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          }),
        );
        const appointment = await fetchAppointmentById(response.id, token);
        mergeAppointmentIntoData(appointment);
        invalidatePlanningCaches({
          providerIds: [draft.providerId],
          dateKeys: [draft.startsAtIso.slice(0, 10)],
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("clinicflow:booking-completed", {
              detail: {
                appointmentId: response.id,
                providerId: draft.providerId,
                dateKey: draft.startsAtIso.slice(0, 10),
              },
            }),
          );
        }
        notify("Appointment booked");
      },
      updateAppointment: async (appointmentId, draft) => {
        const token = requireToken();
        const previous = data.appointments.find((appointment) => appointment.id === appointmentId);
        await apiFetchJson(
          `/appointments/${appointmentId}`,
          withAuthHeaders(token, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          }),
        );
        const appointment = await fetchAppointmentById(appointmentId, token);
        mergeAppointmentIntoData(appointment);
        invalidatePlanningCaches({
          providerIds: [
            draft.providerId,
            previous?.providerId,
          ].filter((value): value is string => Boolean(value)),
          dateKeys: [
            draft.startsAtIso.slice(0, 10),
            previous?.startsAtIso.slice(0, 10),
          ].filter((value): value is string => Boolean(value)),
        });
        notify("Appointment updated");
      },
      rescheduleAppointment: async (appointmentId, draft, reason) => {
        const token = requireToken();
        const previous = data.appointments.find((appointment) => appointment.id === appointmentId);
        const response = await apiFetchJson<{ originalAppointmentId: string; successorAppointmentId: string }>(
          `/appointments/${appointmentId}/reschedule`,
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId: data.organization.id, ...draft, reason }),
          }),
        );
        const [original, successor] = await Promise.all([
          fetchAppointmentById(response.originalAppointmentId, token),
          fetchAppointmentById(response.successorAppointmentId, token),
        ]);
        mergeAppointmentIntoData(original);
        mergeAppointmentIntoData(successor);
        invalidatePlanningCaches({
          providerIds: [previous?.providerId, draft.providerId].filter((value): value is string => Boolean(value)),
          dateKeys: [previous?.startsAtIso.slice(0, 10), draft.startsAtIso.slice(0, 10)].filter((value): value is string => Boolean(value)),
        });
        notify("Appointment rescheduled; the original remains in history");
      },
      deleteAppointment: async (appointmentId) => {
        const token = requireToken();
        const previous = data.appointments.find((appointment) => appointment.id === appointmentId);
        await apiFetchJson(
          `/appointments/${appointmentId}`,
          withAuthHeaders(token, { method: "DELETE" }),
        );
        removeAppointmentFromData(appointmentId);
        invalidatePlanningCaches({
          providerIds: previous ? [previous.providerId] : undefined,
          dateKeys: previous ? [previous.startsAtIso.slice(0, 10)] : undefined,
        });
        notify("Appointment deleted");
      },
      updateAppointmentStatus: async (appointmentId, status, note) => {
        const token = requireToken();
        const previous = data.appointments.find((appointment) => appointment.id === appointmentId);
        const lifecycleAction = {
          Confirmed: "confirm",
          CheckedIn: "check-in",
          InProgress: "start",
          Completed: "complete",
          Cancelled: "cancel",
          NoShow: "no-show",
        }[status];
        if (!lifecycleAction) {
          throw new Error("This appointment status requires a dedicated workflow command");
        }
        await apiFetchJson(
          `/appointments/${appointmentId}/${lifecycleAction}`,
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: note }),
          }),
        );
        if (previous) {
          mergeAppointmentIntoData({
            ...previous,
            status: status as Appointment["status"],
          });
          invalidatePlanningCaches({
            providerIds: [previous.providerId],
            dateKeys: [previous.startsAtIso.slice(0, 10)],
          });
        } else {
          invalidatePlanningCaches();
        }
        notify("Appointment updated");
      },
      createCustomer: async (draft) => {
        await runMutation(
          "/customers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Patient added",
        );
      },
      matchCustomers: async (draft) => {
        const token = requireToken();
        const response = await apiFetchJson<{ matches: CustomerMatch[] }>(
          "/customers/match",
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          }),
        );
        return response.matches;
      },
      resolveCustomerForAppointment: async (draft) => {
        const token = requireToken();
        const customer = await apiFetchJson<Customer>(
          "/customers/resolve-for-appointment",
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          }),
        );
        mergeCustomerIntoData(customer);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("clinicflow:client-changed", {
              detail: { clientId: customer.id },
            }),
          );
        }
        notify(
          draft.mode === "create_new"
            ? "Patient added from appointment"
            : draft.mode === "update_existing"
              ? "Existing patient updated"
              : "Existing patient selected",
        );
        return customer;
      },
      mergeCustomers: async (primaryCustomerId, secondaryCustomerId) => {
        const token = requireToken();
        const customer = await apiFetchJson<Customer>(
          `/customers/${primaryCustomerId}/merge`,
          withAuthHeaders(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              secondaryCustomerId,
            }),
          }),
        );
        mergeCustomerIntoData(customer);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("clinicflow:client-changed", {
              detail: { clientId: primaryCustomerId },
            }),
          );
        }
        notify("Patient records merged");
        return customer;
      },
      updateCustomer: async (customerId, draft) => {
        await runMutation(
          `/customers/${customerId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Patient updated",
        );
      },
      deleteCustomer: async (customerId) => {
        await runMutation(
          `/customers/${customerId}`,
          { method: "DELETE" },
          "Patient deleted",
        );
      },
      createVisitReport: async (customerId, draft) => {
        await runMutation(
          `/customers/${customerId}/visit-reports`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Visit report saved",
        );
      },
      createStaff: async (draft) => {
        await runMutation(
          "/staff",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Staff account created",
        );
      },
      updateStaff: async (staffId, draft) => {
        await runMutation(
          `/staff/${staffId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Staff account updated",
        );
      },
      resetStaffPassword: async (staffId, password) => {
        await runMutation(
          `/staff/${staffId}/password`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          },
          "Password updated",
          "none",
        );
      },
      deactivateStaff: async (staffId) => {
        await runMutation(
          `/staff/${staffId}`,
          { method: "DELETE" },
          "Staff account deactivated",
        );
      },
      restoreStaff: async (staffId) => {
        await runMutation(
          `/staff/${staffId}/restore`,
          { method: "PATCH" },
          "Staff account restored",
        );
      },
      updateProviderSchedule: async (providerId, availability, recurringBlocks, blockedTimes) => {
        await runMutation(
          `/providers/${providerId}/schedule`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              availability,
              recurringBlocks,
              blockedTimes,
            }),
          },
          "Schedule updated",
          "schedule",
        );
        invalidatePlanningCaches({ providerIds: [providerId] });
      },
      fetchAppointmentsRange: async ({ fromIso, toIso, providerId, locationId, signal }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromIso,
          toIso,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = readPlanningCache(appointmentRangeCache, cacheKey);
        if (cached) {
          return cached;
        }
        const activeRequest = appointmentRangeRequests.get(cacheKey);
        if (activeRequest) {
          return waitForPlanningRequest(activeRequest, signal);
        }
        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          fromIso,
          toIso,
        });
        if (providerId) {
          query.set("providerId", providerId);
        }
        if (locationId) {
          query.set("locationId", locationId);
        }
        const request = apiFetchJson<V1Envelope<Appointment[]>>(
          `/v1/schedule/appointments?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(appointmentRangeCache, cacheKey, response);
          }
          return response;
        }).finally(() => {
          if (appointmentRangeRequests.get(cacheKey) === request) {
            appointmentRangeRequests.delete(cacheKey);
          }
        });
        appointmentRangeRequests.set(cacheKey, request);
        return waitForPlanningRequest(request, signal);
      },
      fetchAppointmentDaySummaries: async ({
        fromDateKey,
        toDateKey,
        providerId,
        locationId,
        signal,
      }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromDateKey,
          toDateKey,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = readPlanningCache(daySummaryCache, cacheKey);
        if (cached) {
          return cached;
        }
        const activeRequest = daySummaryRequests.get(cacheKey);
        if (activeRequest) {
          return waitForPlanningRequest(activeRequest, signal);
        }
        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          fromDateKey,
          toDateKey,
        });
        if (providerId) {
          query.set("providerId", providerId);
        }
        if (locationId) {
          query.set("locationId", locationId);
        }
        const request = apiFetchJson<V1Envelope<AppointmentDaySummary[]>>(
          `/v1/schedule/day-summaries?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(daySummaryCache, cacheKey, response);
          }
          return response;
        }).finally(() => {
          if (daySummaryRequests.get(cacheKey) === request) {
            daySummaryRequests.delete(cacheKey);
          }
        });
        daySummaryRequests.set(cacheKey, request);
        return waitForPlanningRequest(request, signal);
      },
      fetchWeekOperationalSummaries: async ({
        fromDateKey,
        toDateKey,
        providerId,
        locationId,
        signal,
      }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromDateKey,
          toDateKey,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = readPlanningCache(weekSummaryCache, cacheKey);
        if (cached) {
          return cached;
        }
        const activeRequest = weekSummaryRequests.get(cacheKey);
        if (activeRequest) {
          return waitForPlanningRequest(activeRequest, signal);
        }
        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          fromDateKey,
          toDateKey,
        });
        if (providerId) {
          query.set("providerId", providerId);
        }
        if (locationId) {
          query.set("locationId", locationId);
        }
        const daysRequest = apiFetchJson<V1Envelope<AppointmentWeekSummaryResponse>>(
          `/v1/schedule/week-summaries?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(weekSummaryCache, cacheKey, response.days);
          }
          return response.days;
        }).finally(() => {
          if (weekSummaryRequests.get(cacheKey) === daysRequest) {
            weekSummaryRequests.delete(cacheKey);
          }
        });
        weekSummaryRequests.set(cacheKey, daysRequest);
        return waitForPlanningRequest(daysRequest, signal);
      },
      fetchScheduleGridForDay: async ({ providerIds, date, locationId }) => {
        const token = requireToken();
        const normalizedProviderIds = [...(providerIds ?? [])].sort();
        const cacheKey = [
          data.organization.id,
          date,
          normalizedProviderIds.join(",") || "providers:all",
          locationId ?? "location:none",
        ].join("|");
        const cached = readPlanningCache(scheduleGridCache, cacheKey);
        if (cached) {
          return cached;
        }
        const activeRequest = scheduleGridRequests.get(cacheKey);
        if (activeRequest) {
          return activeRequest;
        }
        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          organizationId: data.organization.id,
          dateIso: date,
        });
        if (normalizedProviderIds.length) {
          query.set("providerIds", normalizedProviderIds.join(","));
        }
        if (locationId) {
          query.set("locationId", locationId);
        }
        const request = apiFetchJson<V1Envelope<ProviderDayScheduleGrid>>(
          `/v1/schedule/grid?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(scheduleGridCache, cacheKey, response);
          }
          return response;
        }).finally(() => {
          if (scheduleGridRequests.get(cacheKey) === request) {
            scheduleGridRequests.delete(cacheKey);
          }
        });
        scheduleGridRequests.set(cacheKey, request);
        return request;
      },
      fetchScheduleDay: async ({ providerIds, date, locationId, signal }) => {
        const token = requireToken();
        const normalizedProviderIds = [...(providerIds ?? [])].sort();
        const cacheKey = [
          data.organization.id,
          date,
          normalizedProviderIds.join(",") || "providers:all",
          locationId ?? "location:none",
        ].join("|");
        const cached = readPlanningCache(scheduleDayCache, cacheKey);
        if (cached) return cached;
        const activeRequest = scheduleDayRequests.get(cacheKey);
        if (activeRequest) return waitForPlanningRequest(activeRequest, signal);

        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          organizationId: data.organization.id,
          date,
        });
        if (normalizedProviderIds.length) {
          query.set("providerIds", normalizedProviderIds.join(","));
        }
        if (locationId) query.set("locationId", locationId);

        const request = apiFetchJson<V1Envelope<ScheduleDaySnapshot>>(
          `/v1/schedule/day?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(scheduleDayCache, cacheKey, response);
          }
          return response;
        }).finally(() => {
          if (scheduleDayRequests.get(cacheKey) === request) {
            scheduleDayRequests.delete(cacheKey);
          }
        });
        scheduleDayRequests.set(cacheKey, request);
        return waitForPlanningRequest(request, signal);
      },
      fetchProviderSlotsForBooking: async ({
        providerId,
        date,
        locationId,
        serviceId,
        durationMinutes,
        excludeAppointmentId,
      }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          providerId,
          date,
          serviceId ?? "service:none",
          durationMinutes ?? "duration:none",
          locationId ?? "location:none",
          excludeAppointmentId ?? "exclude:none",
        ].join("|");
        const cached = readPlanningCache(slotCache, cacheKey);
        if (cached) {
          return cached;
        }
        const activeRequest = slotRequests.get(cacheKey);
        if (activeRequest) {
          return activeRequest;
        }
        const requestRevision = planningCacheRevision.current;
        const query = new URLSearchParams({
          organizationId: data.organization.id,
          date,
        });
        if (locationId) {
          query.set("locationId", locationId);
        }
        if (serviceId) {
          query.set("serviceId", serviceId);
        }
        if (durationMinutes) {
          query.set("durationMinutes", String(durationMinutes));
        }
        if (excludeAppointmentId) {
          query.set("excludeAppointmentId", excludeAppointmentId);
        }
        const request = apiFetchJson<V1Envelope<ProviderSlotResponse>>(
          `/v1/schedule/providers/${providerId}/slots?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        ).then((envelope) => {
          const response = envelope.data;
          if (planningCacheRevision.current === requestRevision) {
            writePlanningCache(slotCache, cacheKey, response);
          }
          return response;
        }).finally(() => {
          if (slotRequests.get(cacheKey) === request) {
            slotRequests.delete(cacheKey);
          }
        });
        slotRequests.set(cacheKey, request);
        return request;
      },
      updateOrganization: async (draft) => {
        await runMutation(
          `/organizations/${data.organization.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          },
          "Clinic details updated",
        );
      },
      invoices,
      invoicesLoaded,
      invoicesLoading,
      loadInvoices: async (customerId) => {
        const token = requireToken();
        await loadInvoicesInternal(token, customerId);
      },
      createInvoice: async (draft) => {
        await runMutation(
          "/billing/invoices",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Invoice created",
          "billing",
        );
      },
      issueInvoice: async (invoiceId) => {
        await runMutation(
          `/billing/invoices/${invoiceId}/issue`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId: data.organization.id }),
          },
          "Invoice issued and frozen",
          "billing",
        );
      },
      recordPayment: async (invoiceId, draft) => {
        await runMutation(
          `/billing/invoices/${invoiceId}/payments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: data.organization.id,
              ...draft,
            }),
          },
          "Payment recorded",
          "billing",
        );
      },
      deleteInvoice: async (invoiceId) => {
        await runMutation(
          `/billing/invoices/${invoiceId}`,
          { method: "DELETE" },
          "Draft invoice deleted",
          "billing",
        );
      },
    }),
    [
      appointmentRangeCache,
      appointmentRangeRequests,
      bookingBootstrapLoader,
      calendarMode,
      clearToast,
      data,
      initialWorkspaceBootstrap,
      daySummaryCache,
      daySummaryRequests,
      fetchAppointmentById,
      invoices,
      invoicesLoaded,
      invoicesLoading,
      invalidatePlanningCaches,
      isAuthenticating,
      isLoggingOut,
      loadInvoicesInternal,
      logoutError,
      logout,
      clearLogoutError,
      mergeAppointmentIntoData,
      mergeCustomerIntoData,
      refreshOperationalData,
      removeAppointmentFromData,
      requireToken,
      runMutation,
      scheduleGridCache,
      scheduleGridRequests,
      scheduleDayCache,
      scheduleDayRequests,
      selectedDate,
      sessionUser,
      slotCache,
      slotRequests,
      toast,
      planningRevision,
      weekSummaryCache,
      weekSummaryRequests,
      notify,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceApp() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspaceApp must be used inside WorkspaceProvider");
  }
  return context;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { apiFetchJson, SESSION_TOKEN_STORAGE_KEY, withAuthHeaders } from "@/lib/api-client";
import type { OperationalData } from "@/lib/database-data";
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
};

export type AppointmentDraft = {
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

type WorkspaceContextValue = {
  data: OperationalData;
  planningRevision: number;
  calendarMode: CalendarMode;
  setCalendarMode: (mode: CalendarMode) => void;
  selectedDate: string;
  setSelectedDate: (dateKey: string) => void;
  sessionUser: SessionUser | null;
  authToken: string | null;
  isAuthenticating: boolean;
  toast: ToastState;
  clearToast: () => void;
  logout: () => void;
  refreshOperationalData: () => Promise<void>;
  createAppointment: (draft: AppointmentDraft) => Promise<void>;
  updateAppointment: (appointmentId: string, draft: AppointmentDraft) => Promise<void>;
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
  }) => Promise<Appointment[]>;
  fetchAppointmentDaySummaries: (params: {
    fromDateKey: string;
    toDateKey: string;
    providerId?: string;
    locationId?: string;
  }) => Promise<AppointmentDaySummary[]>;
  fetchWeekOperationalSummaries: (params: {
    fromDateKey: string;
    toDateKey: string;
    providerId?: string;
    locationId?: string;
  }) => Promise<AppointmentWeekSummary[]>;
  fetchScheduleGridForDay: (params: {
    providerIds?: string[];
    date: string;
    locationId?: string;
  }) => Promise<ProviderDayScheduleGrid>;
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
  recordPayment: (invoiceId: string, draft: PaymentDraft) => Promise<void>;
  deleteInvoice: (invoiceId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const providerOnlyRoles = new Set(["Provider", "Assistant"]);

export function WorkspaceProvider({
  children,
  initialData,
  todayDateKey,
}: {
  children: ReactNode;
  initialData: OperationalData;
  todayDateKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initialData);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>(
    initialData.organization.primaryCalendar,
  );
  const [selectedDate, setSelectedDate] = useState(todayDateKey);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [planningRevision, setPlanningRevision] = useState(0);
  const [slotCache] = useState(() => new Map<string, ProviderSlotResponse>());
  const [appointmentRangeCache] = useState(() => new Map<string, Appointment[]>());
  const [daySummaryCache] = useState(() => new Map<string, AppointmentDaySummary[]>());
  const [weekSummaryCache] = useState(() => new Map<string, AppointmentWeekSummary[]>());
  const [scheduleGridCache] = useState(() => new Map<string, ProviderDayScheduleGrid>());

  const notify = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const invalidatePlanningCaches = useCallback((params?: {
    providerIds?: string[];
    dateKeys?: string[];
  }) => {
    appointmentRangeCache.clear();
    daySummaryCache.clear();
    weekSummaryCache.clear();

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

    setPlanningRevision((current) => current + 1);
  }, [appointmentRangeCache, daySummaryCache, scheduleGridCache, slotCache, weekSummaryCache]);

  const requireToken = useCallback(() => {
    if (!authToken) {
      throw new Error("Please sign in again.");
    }

    return authToken;
  }, [authToken]);

  const refreshOperationalData = useCallback(async () => {
    const nextData = await apiFetchJson<OperationalData>(
      "/operational-data",
      withAuthHeaders(authToken, {
        cache: "no-store",
      }),
    );

    setData(nextData);
    setCalendarMode((current) => current || nextData.organization.primaryCalendar);
  }, [authToken]);

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

  const fetchAppointmentById = useCallback(async (appointmentId: string, token: string) => {
    return apiFetchJson<Appointment>(
      `/appointments/${appointmentId}`,
      withAuthHeaders(token, { cache: "no-store" }),
    );
  }, []);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (!storedToken) {
      setIsAuthenticating(false);
      router.replace("/login");
      return;
    }

    setAuthToken(storedToken);
    apiFetchJson<SessionUser>("/auth/me", withAuthHeaders(storedToken))
      .then((user) => {
        setSessionUser(user);
        if (user.providerId && providerOnlyRoles.has(user.role) && pathname === "/dashboard") {
          router.replace("/my-schedule");
        }
      })
      .catch(() => {
        window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
        setAuthToken(null);
        setSessionUser(null);
        router.replace("/login");
      })
      .finally(() => setIsAuthenticating(false));
  }, [pathname, router]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    setSessionUser(null);
    setAuthToken(null);
    setInvoices([]);
    setInvoicesLoaded(false);
    notify("Signed out");
    router.replace("/login");
  }, [notify, router]);

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
      refresh: "operational" | "billing" | "both" | "none" = "operational",
    ) => {
      const token = requireToken();
      await apiFetchJson(path, withAuthHeaders(token, init));
      slotCache.clear();

      if (refresh === "operational" || refresh === "both") {
        await refreshOperationalData();
      }

      if (refresh === "billing" || refresh === "both") {
        await loadInvoicesInternal(token);
      }

      notify(successMessage);
    },
    [loadInvoicesInternal, notify, refreshOperationalData, requireToken, slotCache],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      planningRevision,
      calendarMode,
      setCalendarMode,
      selectedDate,
      setSelectedDate,
      sessionUser,
      authToken,
      isAuthenticating,
      toast,
      clearToast,
      logout,
      refreshOperationalData,
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
        await apiFetchJson(
          `/appointments/${appointmentId}/status`,
          withAuthHeaders(token, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, note }),
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
        await refreshOperationalData();
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
        await refreshOperationalData();
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
        );
        invalidatePlanningCaches({ providerIds: [providerId] });
      },
      fetchAppointmentsRange: async ({ fromIso, toIso, providerId, locationId }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromIso,
          toIso,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = appointmentRangeCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
        const response = await apiFetchJson<Appointment[]>(
          `/appointments?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        );
        appointmentRangeCache.set(cacheKey, response);
        return response;
      },
      fetchAppointmentDaySummaries: async ({
        fromDateKey,
        toDateKey,
        providerId,
        locationId,
      }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromDateKey,
          toDateKey,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = daySummaryCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
        const response = await apiFetchJson<AppointmentDaySummary[]>(
          `/appointments/day-summaries?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        );
        daySummaryCache.set(cacheKey, response);
        return response;
      },
      fetchWeekOperationalSummaries: async ({
        fromDateKey,
        toDateKey,
        providerId,
        locationId,
      }) => {
        const token = requireToken();
        const cacheKey = [
          data.organization.id,
          fromDateKey,
          toDateKey,
          providerId ?? "provider:none",
          locationId ?? "location:none",
        ].join("|");
        const cached = weekSummaryCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
        const response = await apiFetchJson<AppointmentWeekSummaryResponse>(
          `/appointments/week-summaries?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        );
        weekSummaryCache.set(cacheKey, response.days);
        return response.days;
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
        const cached = scheduleGridCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
        const response = await apiFetchJson<ProviderDayScheduleGrid>(
          `/providers/schedule-grid?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        );
        scheduleGridCache.set(cacheKey, response);
        return response;
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
        const cached = slotCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
        const response = await apiFetchJson<ProviderSlotResponse>(
          `/providers/${providerId}/slots?${query.toString()}`,
          withAuthHeaders(token, { cache: "no-store" }),
        );
        slotCache.set(cacheKey, response);
        return response;
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
      authToken,
      calendarMode,
      clearToast,
      data,
      daySummaryCache,
      fetchAppointmentById,
      invoices,
      invoicesLoaded,
      invoicesLoading,
      invalidatePlanningCaches,
      isAuthenticating,
      loadInvoicesInternal,
      logout,
      mergeAppointmentIntoData,
      refreshOperationalData,
      removeAppointmentFromData,
      requireToken,
      runMutation,
      scheduleGridCache,
      selectedDate,
      sessionUser,
      slotCache,
      toast,
      planningRevision,
      weekSummaryCache,
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

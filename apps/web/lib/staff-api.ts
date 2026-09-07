import type {
  AvailabilityDraft,
  BlockedTimeDraft,
  RecurringBlockDraft,
  StaffDraft,
} from "@/components/workspace/app-state";
import { apiFetchJson } from "@/lib/api-client";
import type { StaffMember } from "@/lib/domain";
import type { StaffDirectoryData } from "@/lib/staff-domain";

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

export function loadStaffDirectory(options: {
  page?: number;
  limit?: number;
  query?: string;
  role?: string;
  status?: string;
  locationId?: string;
  sort?: "name" | "role" | "status" | "lastLogin";
  direction?: "asc" | "desc";
  signal?: AbortSignal;
} = {}) {
  const query = queryString({
    page: options.page,
    limit: options.limit,
    query: options.query,
    role: options.role,
    status: options.status,
    locationId: options.locationId,
    sort: options.sort,
    direction: options.direction,
  });
  return apiFetchJson<V1Envelope<StaffDirectoryData>>(
    `/v1/staff${query ? `?${query}` : ""}`,
    { cache: "no-store", signal: options.signal },
  ).then((response) => response.data);
}

export function loadStaffDetail(staffId: string, signal?: AbortSignal) {
  return apiFetchJson<V1Envelope<{ item: StaffMember }>>(
    `/v1/staff/${encodeURIComponent(staffId)}`,
    { cache: "no-store", signal },
  ).then((response) => response.data.item);
}

export function createStaffMember(organizationId: string, draft: StaffDraft) {
  return apiFetchJson<StaffMember>("/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, ...draft }),
  });
}

export function updateStaffMember(
  organizationId: string,
  staffId: string,
  draft: StaffDraft,
) {
  return apiFetchJson<StaffMember>(`/staff/${encodeURIComponent(staffId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, ...draft, password: undefined }),
  });
}

export function resetStaffMemberPassword(staffId: string, password: string) {
  return apiFetchJson(`/staff/${encodeURIComponent(staffId)}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function deactivateStaffMember(staffId: string) {
  return apiFetchJson(`/staff/${encodeURIComponent(staffId)}`, {
    method: "DELETE",
  });
}

export function restoreStaffMember(staffId: string) {
  return apiFetchJson(`/staff/${encodeURIComponent(staffId)}/restore`, {
    method: "PATCH",
  });
}

export function updateStaffProviderSchedule(
  organizationId: string,
  providerId: string,
  availability: AvailabilityDraft[],
  recurringBlocks: RecurringBlockDraft[],
  blockedTimes: BlockedTimeDraft[],
) {
  return apiFetchJson(`/providers/${encodeURIComponent(providerId)}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      availability,
      recurringBlocks,
      blockedTimes,
    }),
  });
}

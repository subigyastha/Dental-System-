import type { StaffMember } from "@/lib/domain";

export type StaffAssignmentSummary = {
  id: string;
  role: StaffMember["role"];
  locationId: string | null;
  location: { id: string; name: string } | null;
};

export type StaffDirectoryItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  primaryRole: StaffMember["role"];
  staffLabel: string;
  department: string | null;
  employeeCode: string | null;
  status: StaffMember["status"];
  isSchedulable: boolean;
  lastLoginAtIso: string | null;
  provider: {
    id: string;
    displayName: string;
    specialty: string;
    color: string;
    status: string;
  } | null;
  assignments: StaffAssignmentSummary[];
};

export type StaffDirectoryData = {
  capabilities: {
    canManageStaff: boolean;
    canManageAccess: boolean;
  };
  summary: {
    active: number;
    invited: number;
    inactive: number;
    suspended: number;
    schedulable: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
  };
  items: StaffDirectoryItem[];
};

export function directoryItemToStaffMember(
  organizationId: string,
  item: StaffDirectoryItem,
): StaffMember {
  return {
    id: item.id,
    organizationId,
    providerId: item.provider?.id,
    name: item.name,
    email: item.email,
    phone: item.phone ?? undefined,
    role: item.primaryRole,
    staffLabel: item.staffLabel,
    department: item.department ?? undefined,
    employeeCode: item.employeeCode ?? undefined,
    status: item.status,
    isSchedulable: item.isSchedulable,
    lastLoginAtIso: item.lastLoginAtIso ?? undefined,
  };
}

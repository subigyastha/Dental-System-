import type { Prisma } from "@prisma/client";

import { mapProviderToClient } from "./map-provider";

type StaffWithRelations = Prisma.UserGetPayload<{
  include: {
    provider: {
      include: {
        availability: true;
        recurringBlocks: true;
        blockedTimes: true;
        providerServices: true;
      };
    };
  };
}>;

export function mapStaffToClient(user: StaffWithRelations) {
  return {
    id: user.id,
    organizationId: user.organizationId ?? "",
    providerId: user.provider?.id ?? undefined,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    role: user.role,
    staffLabel: user.staffLabel ?? user.role,
    department: user.department ?? undefined,
    employeeCode: user.employeeCode ?? undefined,
    licenseNumber: user.licenseNumber ?? undefined,
    employmentType: user.employmentType ?? undefined,
    startDateIso: user.startDate?.toISOString(),
    emergencyContactName: user.emergencyContactName ?? undefined,
    emergencyContactPhone: user.emergencyContactPhone ?? undefined,
    notes: user.notes ?? undefined,
    status: user.status,
    isSchedulable: user.isSchedulable,
    provider: user.provider ? mapProviderToClient(user.provider) : undefined,
    lastLoginAtIso: user.lastLoginAt?.toISOString(),
  };
}

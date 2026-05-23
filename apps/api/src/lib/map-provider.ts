import type { Prisma } from "@prisma/client";

const STANDARD_SLOT_MINUTES = 60;

type ProviderWithRelations = Prisma.ProviderGetPayload<{
  include: {
    availability: true;
    recurringBlocks: true;
    blockedTimes: true;
    providerServices: true;
  };
}>;

export function mapProviderStatus(
  status: string,
): "Available" | "Busy" | "Away" | "Inactive" {
  if (status === "Busy" || status === "Away" || status === "Inactive") {
    return status;
  }
  return "Available";
}

export function mapProviderToClient(provider: ProviderWithRelations) {
  return {
    id: provider.id,
    userId: provider.userId ?? undefined,
    name: provider.displayName,
    roleLabel: provider.roleLabel,
    specialty: provider.specialty ?? "General service",
    color: provider.color,
    capacityMinutes: 420,
    bookedMinutes: 0,
    status: mapProviderStatus(provider.status),
    availability: provider.availability.map((item) => ({
      id: item.id,
      providerId: item.providerId,
      locationId: item.locationId ?? undefined,
      dayOfWeek: item.dayOfWeek,
      startsAtLocal: item.startsAtLocal,
      endsAtLocal: item.endsAtLocal,
      slotDurationMinutes: STANDARD_SLOT_MINUTES,
      bufferMinutes: item.bufferMinutes,
      isActive: item.isActive,
    })),
    recurringBlocks: provider.recurringBlocks.map((item) => ({
      id: item.id,
      providerId: item.providerId,
      locationId: item.locationId ?? undefined,
      dayOfWeek: item.dayOfWeek,
      startsAtLocal: item.startsAtLocal,
      endsAtLocal: item.endsAtLocal,
      reason: item.reason,
      isActive: item.isActive,
    })),
    blockedTimes: provider.blockedTimes.map((item) => ({
      id: item.id,
      providerId: item.providerId ?? undefined,
      locationId: item.locationId ?? undefined,
      startsAtIso: item.startsAt.toISOString(),
      endsAtIso: item.endsAt.toISOString(),
      reason: item.reason,
    })),
    serviceIds: provider.providerServices
      .filter((item) => item.isActive)
      .map((item) => item.serviceId),
  };
}

import type { BookingBootstrap } from "@/lib/booking-bootstrap";
import type { Location, Provider, Service } from "@/lib/domain";

export type AppointmentBookingProvider = {
  id: string;
  name: string;
  roleLabel?: string;
  specialty?: string | null;
  isActive: boolean;
  serviceOptions: Array<{
    serviceId: string;
    durationMinutes: number;
    bufferMinutes: number;
  }>;
};

export type AppointmentBookingService = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
};

export type AppointmentBookingReferences = {
  locationId: string;
  locationName: string;
  providers: AppointmentBookingProvider[];
  services: AppointmentBookingService[];
  defaultProviderId: string;
  error: string | null;
};

export function resolveAppointmentBookingReferences({
  bookingBootstrap,
  legacyLocation,
  legacyProviders,
  legacyServices,
  locationId,
  useLegacyReferences,
}: {
  bookingBootstrap?: BookingBootstrap;
  legacyLocation?: Location;
  legacyProviders: Provider[];
  legacyServices: Service[];
  locationId?: string;
  useLegacyReferences: boolean;
}): AppointmentBookingReferences {
  if (bookingBootstrap && !useLegacyReferences) {
    const selectedLocationId =
      locationId?.trim() ||
      bookingBootstrap.bookingDefaults.defaultLocationId ||
      bookingBootstrap.location.id;

    if (selectedLocationId !== bookingBootstrap.location.id) {
      return emptyReferences(
        selectedLocationId,
        "Booking details are not available for the selected clinic location.",
      );
    }

    return {
      locationId: selectedLocationId,
      locationName: bookingBootstrap.location.name,
      providers: bookingBootstrap.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        roleLabel: provider.roleLabel,
        specialty: provider.specialty,
        isActive: true,
        serviceOptions: provider.serviceOptions,
      })),
      services: bookingBootstrap.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
      })),
      defaultProviderId: bookingBootstrap.bookingDefaults.defaultProviderId ?? "",
      error:
        bookingBootstrap.providers.length === 0
          ? "No active providers are available for this clinic location."
          : bookingBootstrap.services.length === 0
            ? "No active services are available for this clinic location."
            : null,
    };
  }

  if (!useLegacyReferences) {
    return emptyReferences(
      locationId?.trim() ?? "",
      "Booking details are still loading. Close this panel and try again.",
    );
  }

  const selectedLocationId = locationId?.trim() || legacyLocation?.id || "";
  return {
    locationId: selectedLocationId,
    locationName: legacyLocation?.name ?? "Current clinic",
    providers: legacyProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      roleLabel: provider.roleLabel,
      specialty: provider.specialty,
      isActive: provider.status !== "Inactive",
      serviceOptions: provider.serviceIds.map((serviceId) => {
        const service = legacyServices.find((item) => item.id === serviceId);
        return {
          serviceId,
          durationMinutes: service?.durationMinutes ?? 60,
          bufferMinutes: service?.bufferMinutes ?? 0,
        };
      }),
    })),
    services: legacyServices.map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
    })),
    defaultProviderId: "",
    error: selectedLocationId
      ? null
      : "Choose a clinic location before saving this appointment.",
  };
}

export function servicesForBookingProvider(
  references: AppointmentBookingReferences,
  providerId: string,
) {
  if (!providerId) {
    return references.services;
  }

  const provider = references.providers.find((item) => item.id === providerId);
  if (!provider) {
    return [];
  }

  const allowedServiceIds = new Set(
    provider.serviceOptions.map((option) => option.serviceId),
  );
  return references.services.filter((service) =>
    allowedServiceIds.has(service.id),
  );
}

export function effectiveBookingService(
  references: AppointmentBookingReferences,
  providerId: string,
  serviceId: string,
) {
  const service = references.services.find((item) => item.id === serviceId);
  if (!service) {
    return undefined;
  }

  const provider = references.providers.find((item) => item.id === providerId);
  const providerOption = provider?.serviceOptions.find(
    (option) => option.serviceId === serviceId,
  );

  return {
    ...service,
    durationMinutes:
      providerOption?.durationMinutes ?? service.durationMinutes,
    bufferMinutes: providerOption?.bufferMinutes ?? service.bufferMinutes,
  };
}

function emptyReferences(
  locationId: string,
  error: string,
): AppointmentBookingReferences {
  return {
    locationId,
    locationName: "Selected clinic",
    providers: [],
    services: [],
    defaultProviderId: "",
    error,
  };
}

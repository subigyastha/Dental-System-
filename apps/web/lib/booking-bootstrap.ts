export type BookingBootstrap = {
  context: {
    organization: {
      id: string;
      timezone: string;
    };
    actor: {
      id: string;
      providerId: string | null;
    };
    permissions: {
      canCreateAppointment: true;
      providerScope: "any" | "self";
    };
  };
  bookingDefaults: {
    dateInputCalendar: "AD";
    showBsDateEquivalent: boolean;
    slotIntervalMinutes: number;
    bufferMinutes: number;
    holdMinutes: number;
    defaultLocationId: string;
    defaultProviderId: string | null;
  };
  location: {
    id: string;
    name: string;
    timezone: string;
  };
  providers: Array<{
    id: string;
    name: string;
    roleLabel: string;
    specialty: string | null;
    status: "Available" | "Busy" | "Away";
    color: string;
    serviceOptions: Array<{
      serviceId: string;
      durationMinutes: number;
      bufferMinutes: number;
    }>;
  }>;
  services: Array<{
    id: string;
    name: string;
    category: string;
    durationMinutes: number;
    bufferMinutes: number;
  }>;
};

export type BookingBootstrapEnvelope = {
  data: BookingBootstrap;
  meta: {
    apiVersion: "v1";
    requestId?: string;
  };
};

export function unwrapBookingBootstrap(
  envelope: BookingBootstrapEnvelope,
  expectedLocationId?: string,
) {
  if (envelope.meta?.apiVersion !== "v1" || !envelope.data) {
    throw new Error("The booking service returned an unsupported response.");
  }
  if (
    expectedLocationId &&
    envelope.data.location.id !== expectedLocationId
  ) {
    throw new Error("The booking service returned data for another location.");
  }
  return envelope.data;
}

/**
 * Session-local loader for the bounded booking reference payload. Repeated
 * opens share one in-flight request per location, failures remain retryable,
 * and callers can clear all references immediately on logout/session expiry.
 */
export function createBookingBootstrapLoader(
  fetchBootstrap: (
    locationId: string,
  ) => Promise<BookingBootstrapEnvelope>,
) {
  const requests = new Map<string, Promise<BookingBootstrap>>();

  return {
    load(locationId: string) {
      const normalizedLocationId = locationId.trim();
      if (!normalizedLocationId) {
        return Promise.reject(
          new Error("Choose a clinic location before booking."),
        );
      }

      const cached = requests.get(normalizedLocationId);
      if (cached) {
        return cached;
      }

      const request = fetchBootstrap(normalizedLocationId)
        .then((response) =>
          unwrapBookingBootstrap(response, normalizedLocationId),
        )
        .catch((error) => {
          requests.delete(normalizedLocationId);
          throw error;
        });
      requests.set(normalizedLocationId, request);
      return request;
    },
    clear() {
      requests.clear();
    },
  };
}

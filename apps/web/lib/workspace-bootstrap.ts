import type { OperationalData } from "@/lib/database-data";
import type { SessionUser } from "@/lib/domain";

export type WorkspaceBootstrap = {
  /** The guard-authenticated user is returned with the shell read model so
   * initial navigation requires one authenticated request instead of two. */
  user: SessionUser;
  context: {
    capabilities: {
      canCreateAppointment: boolean;
      canCreateClient: boolean;
      canAccessInventory: boolean;
      canAccessStaff: boolean;
      canAccessSettings: boolean;
    };
    organization: {
      id: string;
      name: string;
      businessType?: string;
      timezone: string;
      primaryCalendar: "AD" | "BS";
    };
    actor: {
      id: string;
      name: string;
      providerId?: string;
      roles: string[];
      roleSource: string;
    };
  };
  locations: Array<{
    id: string;
    name: string;
    timezone: string;
    canCreateAppointment: boolean;
    canManageInventory: boolean;
  }>;
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export function unwrapWorkspaceBootstrap(
  envelope: V1Envelope<WorkspaceBootstrap>,
): WorkspaceBootstrap {
  if (envelope.meta?.apiVersion !== "v1" || !envelope.data) {
    throw new Error("The workspace service returned an unsupported response.");
  }
  return envelope.data;
}

/**
 * Compatibility shape for the existing shell/provider. Route-owned screens
 * must fetch their own data and cannot mistake these empty collections for an
 * authoritative domain response.
 */
export function minimalOperationalData(
  bootstrap: WorkspaceBootstrap,
): OperationalData {
  const { organization } = bootstrap.context;
  return {
    dataScope: "shell",
    organization,
    locations: bootstrap.locations.map((location) => ({
      id: location.id,
      name: location.name,
      timezone: location.timezone,
      organizationId: organization.id,
      isActive: true,
    })),
    providers: [],
    staff: [],
    customers: [],
    services: [],
    appointments: [],
    followUps: [],
    visitReports: [],
    databaseConnected: true,
  };
}

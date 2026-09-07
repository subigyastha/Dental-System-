import type { OperationalData } from "@/lib/database-data";
import type { Provider, Service } from "@/lib/domain";
import {
  minimalOperationalData,
  type WorkspaceBootstrap,
} from "@/lib/workspace-bootstrap";

export type ScheduleBootstrap = {
  context: {
    organizationId: string;
    generatedAtIso: string;
  };
  providers: Provider[];
  services: Service[];
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export function unwrapScheduleBootstrap(
  envelope: V1Envelope<ScheduleBootstrap>,
): ScheduleBootstrap {
  if (envelope.meta?.apiVersion !== "v1" || !envelope.data) {
    throw new Error("The schedule service returned an unsupported response.");
  }
  return envelope.data;
}

export function scheduleOperationalData(
  workspace: WorkspaceBootstrap,
  schedule: ScheduleBootstrap,
): OperationalData {
  if (workspace.context.organization.id !== schedule.context.organizationId) {
    throw new Error("The schedule response does not belong to this workspace.");
  }
  return {
    ...minimalOperationalData(workspace),
    dataScope: "schedule",
    providers: schedule.providers,
    services: schedule.services,
  };
}

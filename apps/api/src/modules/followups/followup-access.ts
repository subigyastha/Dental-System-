import { Prisma } from "@prisma/client";

import { type AuthSession } from "../auth/auth.service";
import { assertBookingActor, assertClinicOperator, clinicOperatorRoles } from "../auth/authz";

/** Unlinked tasks require organization-wide authority; a location grant cannot imply it. */
export function assertFollowupActor(
  actor: AuthSession,
  task: { ownerId: string | null; appointment: { locationId: string | null; providerId: string } | null },
) {
  assertClinicOperator(actor);
  assertBookingActor(actor, task.appointment?.locationId, task.appointment?.providerId ?? task.ownerId ?? "");
}

export function canManageFollowup(actor: AuthSession, task: Parameters<typeof assertFollowupActor>[1]) {
  try {
    assertFollowupActor(actor, task);
    return true;
  } catch {
    return false;
  }
}

export function recallAppointmentLocationScope(actor: AuthSession): Prisma.AppointmentWhereInput {
  if (!actor.effectiveRoleScopes) return {};
  const scopes = actor.effectiveRoleScopes.filter((scope) => clinicOperatorRoles.has(scope.role));
  if (scopes.some((scope) => scope.locationId === null)) return {};
  return { locationId: { in: scopes.flatMap((scope) => scope.locationId ? [scope.locationId] : []) } };
}

export function followupLocationScope(actor: AuthSession): Prisma.FollowUpTaskWhereInput {
  const appointmentScope = recallAppointmentLocationScope(actor);
  return Object.keys(appointmentScope).length ? { appointment: { is: appointmentScope } } : {};
}

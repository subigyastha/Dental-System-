import { ForbiddenException } from "@nestjs/common";

export const clinicAdminRoles = new Set(["Owner", "Admin", "Manager"]);
export const clinicOperatorRoles = new Set([
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
  "Provider",
  "Assistant",
]);
export const financeRoles = new Set([
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
  "Finance",
]);

export type AuthorizationRoleSubject = string | {
  role: string;
  effectiveRoles?: readonly string[];
  effectiveRoleScopes?: ReadonlyArray<{ role: string; locationId: string | null }>;
};

/** Empty effective roles are meaningful: enforcement has denied the membership. */
export function effectiveRoleUnion(subject: AuthorizationRoleSubject) {
  return typeof subject === "string" ? [subject] : subject.effectiveRoles ?? [subject.role];
}

export function hasRole(subject: AuthorizationRoleSubject, role: string) {
  return effectiveRoleUnion(subject).includes(role);
}

export function hasAnyRole(subject: AuthorizationRoleSubject, roles: ReadonlySet<string>) {
  return effectiveRoleUnion(subject).some((role) => roles.has(role));
}

export function effectiveRoleUnionForLocation(subject: AuthorizationRoleSubject, locationId: string | null | undefined) {
  if (!locationId) return effectiveRoleUnion(subject);
  if (typeof subject === "string") return [subject];
  if (!subject.effectiveRoleScopes) return effectiveRoleUnion(subject);
  return subject.effectiveRoleScopes
    .filter((scope) => scope.locationId === null || scope.locationId === locationId)
    .map((scope) => scope.role);
}

function hasAnyRoleForLocation(subject: AuthorizationRoleSubject, roles: ReadonlySet<string>, locationId: string | null | undefined) {
  return effectiveRoleUnionForLocation(subject, locationId).some((role) => roles.has(role));
}

export function assertClinicOperatorForLocation(subject: AuthorizationRoleSubject, locationId: string | null | undefined) {
  if (!locationId || !hasAnyRoleForLocation(subject, clinicOperatorRoles, locationId)) {
    throw new ForbiddenException("You are not allowed to manage clinic operations at this location");
  }
}

export function assertFinanceOperatorForLocation(subject: AuthorizationRoleSubject, locationId: string | null | undefined) {
  if (!locationId || !hasAnyRoleForLocation(subject, financeRoles, locationId)) {
    throw new ForbiddenException("You are not allowed to manage billing at this location");
  }
}

export function isClinicAdmin(subject: AuthorizationRoleSubject) {
  return hasAnyRole(subject, clinicAdminRoles);
}

export function assertClinicAdmin(subject: AuthorizationRoleSubject) {
  if (!isClinicAdmin(subject)) {
    throw new ForbiddenException("You are not allowed to manage clinic staff");
  }
}

export function assertClinicOperator(subject: AuthorizationRoleSubject) {
  if (!hasAnyRole(subject, clinicOperatorRoles)) {
    throw new ForbiddenException("You are not allowed to manage clinic operations");
  }
}

export function assertFinanceOperator(subject: AuthorizationRoleSubject) {
  if (!hasAnyRole(subject, financeRoles)) {
    throw new ForbiddenException("You are not allowed to manage billing");
  }
}

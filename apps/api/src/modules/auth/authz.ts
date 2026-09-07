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
  "Receptionist",
  "Finance",
]);
export const broadBookingRoles = new Set([
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
]);
export const bookingRoles = new Set([
  ...broadBookingRoles,
  "Provider",
]);
export const clientIdentityWriteRoles = new Set([
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
]);
export const clientIdentityCreateRoles = new Set([
  ...clientIdentityWriteRoles,
  "Provider",
]);
export const clientPhoneAppendRoles = new Set([
  ...clientIdentityWriteRoles,
  "Provider",
]);

export type AuthorizationRoleSubject = string | {
  role: string;
  providerId?: string;
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

/**
 * Returns `null` when the actor may book any Provider, or the only Provider ID
 * that a Provider-only actor may book. Location-scoped assignments never
 * authorize an organization-scoped booking with no location.
 */
export function bookingProviderScope(
  subject: AuthorizationRoleSubject,
  locationId: string | null | undefined,
): string | null {
  const roles = (() => {
    if (typeof subject === "string") return [subject];
    if (locationId) return effectiveRoleUnionForLocation(subject, locationId);
    if (!subject.effectiveRoleScopes) return effectiveRoleUnion(subject);
    return subject.effectiveRoleScopes
      .filter((scope) => scope.locationId === null)
      .map((scope) => scope.role);
  })();

  if (roles.some((role) => broadBookingRoles.has(role))) return null;
  if (roles.includes("Provider") && typeof subject !== "string" && subject.providerId) {
    return subject.providerId;
  }
  throw new ForbiddenException("You are not allowed to create clinic appointments");
}

export function assertBookingActor(
  subject: AuthorizationRoleSubject,
  locationId: string | null | undefined,
  providerId: string,
) {
  const providerScope = bookingProviderScope(subject, locationId);
  if (providerScope && providerScope !== providerId) {
    throw new ForbiddenException("Providers may book only their own appointments");
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

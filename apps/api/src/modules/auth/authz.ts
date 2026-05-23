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
]);

export function isClinicAdmin(role: string) {
  return clinicAdminRoles.has(role);
}

export function assertClinicAdmin(role: string) {
  if (!isClinicAdmin(role)) {
    throw new ForbiddenException("You are not allowed to manage clinic staff");
  }
}

export function assertClinicOperator(role: string) {
  if (!clinicOperatorRoles.has(role)) {
    throw new ForbiddenException("You are not allowed to manage clinic operations");
  }
}

export function assertFinanceOperator(role: string) {
  if (!financeRoles.has(role)) {
    throw new ForbiddenException("You are not allowed to manage billing");
  }
}

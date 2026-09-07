/**
 * Phase 1 endpoint inventory. Nest applies SessionAuthGuard globally: every
 * route is authenticated unless it is listed as an explicit public exception
 * below. Worker and payment-provider webhook route classes do not exist yet.
 */
export const routeInventory = [
  { controller: "v1/booking", classification: "authenticated", publicActions: [] },
  { controller: "v1/dashboard", classification: "authenticated", publicActions: [] },
  { controller: "v1/clients", classification: "authenticated", publicActions: [] },
  { controller: "v1/schedule", classification: "authenticated", publicActions: [] },
  { controller: "v1/finance", classification: "authenticated", publicActions: [] },
  { controller: "v1/inventory", classification: "authenticated", publicActions: [] },
  { controller: "v1/staff", classification: "authenticated", publicActions: [] },
  { controller: "v1/settings", classification: "authenticated", publicActions: [] },
  { controller: "v1/workspace", classification: "authenticated", publicActions: [] },
  { controller: "appointments", classification: "authenticated", publicActions: [] },
  { controller: "auth", classification: "authenticated", publicActions: ["POST /login"] },
  { controller: "billing", classification: "authenticated", publicActions: [] },
  { controller: "communications", classification: "authenticated", publicActions: [] },
  { controller: "customers", classification: "authenticated", publicActions: [] },
  { controller: "followups", classification: "authenticated", publicActions: [] },
  {
    controller: "health",
    classification: "authenticated",
    publicActions: ["GET /live", "GET /ready"],
  },
  { controller: "operational-data", classification: "authenticated", publicActions: [] },
  { controller: "organizations", classification: "authenticated", publicActions: [] },
  { controller: "platform", classification: "authenticated", publicActions: [] },
  { controller: "providers", classification: "authenticated", publicActions: [] },
  { controller: "auth/role-governance", classification: "authenticated", publicActions: [] },
  { controller: "staff", classification: "authenticated", publicActions: [] },
  { controller: "system", classification: "authenticated", publicActions: [] },
] as const;

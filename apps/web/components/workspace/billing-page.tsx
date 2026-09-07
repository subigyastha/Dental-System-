"use client";

import { FinanceWorkspace } from "@/components/workspace/finance/finance-workspace";

/**
 * Compatibility export for the existing /billing route.
 *
 * The product calls this bounded context Finance. Keep the route stable while
 * all UI and authorization decisions come from the v1 Finance workspace.
 */
export function BillingPage() {
  return <FinanceWorkspace />;
}

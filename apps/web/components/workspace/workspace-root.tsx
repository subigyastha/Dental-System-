"use client";

import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/app-state";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { OperationalData } from "@/lib/database-data";

export function WorkspaceRoot({
  children,
  initialData,
  todayDateKey,
}: {
  children: ReactNode;
  initialData: OperationalData;
  todayDateKey: string;
}) {
  return (
    <WorkspaceProvider initialData={initialData} todayDateKey={todayDateKey}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}

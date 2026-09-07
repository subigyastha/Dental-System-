"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { WorkspaceProvider } from "@/components/workspace/app-state";
import { QuickBookProvider } from "@/components/workspace/quick-book-provider";
import { SecureSignOutProvider } from "@/components/workspace/secure-sign-out";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  WorkspaceContentSkeleton,
  WorkspaceShellSkeleton,
} from "@/components/workspace/workspace-shell-skeleton";
import { ApiRequestError, apiFetchJson } from "@/lib/api-client";
import type { OperationalData } from "@/lib/database-data";
import type { SessionUser } from "@/lib/domain";
import { resolveWorkspaceGate } from "@/lib/workspace-access";
import {
  minimalOperationalData,
  type WorkspaceBootstrap,
} from "@/lib/workspace-bootstrap";
import { workspaceDataPolicy } from "@/lib/workspace-data-policy";
import {
  scheduleOperationalData,
  unwrapScheduleBootstrap,
  type ScheduleBootstrap,
} from "@/lib/schedule-bootstrap";
import { isPlatformOnlyUser } from "@/lib/session-routing";
import { subscribeToSessionEnd } from "@/lib/session-events";
import {
  clearWorkspaceSessionCache,
  loadWorkspaceSession,
} from "@/lib/workspace-session-loader";

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export function WorkspaceRoot({
  children,
  todayDateKey,
}: {
  children: ReactNode;
  todayDateKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dataPolicy = workspaceDataPolicy(pathname);
  const redirectProviderFromDashboard = pathname === "/dashboard";
  const [data, setData] = useState<OperationalData | null>(null);
  const [workspaceBootstrap, setWorkspaceBootstrap] =
    useState<WorkspaceBootstrap | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresSignIn, setRequiresSignIn] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setRequiresSignIn(false);
    setError(null);
    try {
      const scheduleRequest = dataPolicy === "schedule-bootstrap"
        ? apiFetchJson<V1Envelope<ScheduleBootstrap>>(
            `/v1/schedule/bootstrap?detail=${pathname.startsWith("/my-schedule") ? "full" : "summary"}`,
            {
            cache: "no-store",
            },
          )
        : null;
      void scheduleRequest?.catch(() => undefined);
      const { bootstrap, user } = await loadWorkspaceSession();
      if (isPlatformOnlyUser(user)) {
        router.replace("/platform");
        return;
      }

      if (
        redirectProviderFromDashboard &&
        user.providerId &&
        ["Provider", "Assistant"].includes(user.role)
      ) {
        router.replace("/my-schedule");
        return;
      }

      setSessionUser(user);
      setWorkspaceBootstrap(bootstrap);
      setData(minimalOperationalData(bootstrap));
      if (dataPolicy === "schedule-bootstrap" && scheduleRequest) {
        const scheduleResponse = await scheduleRequest;
        setData(
          scheduleOperationalData(
            bootstrap,
            unwrapScheduleBootstrap(scheduleResponse),
          ),
        );
      }
    } catch (loadError) {
      setData(null);
      setWorkspaceBootstrap(null);
      setSessionUser(null);
      if (loadError instanceof ApiRequestError && loadError.status === 401) {
        clearWorkspaceSessionCache();
        setRequiresSignIn(true);
        router.replace("/login");
        return;
      }
      setError(
        "Clinic data is temporarily unavailable. Check your connection and try again.",
      );
    }
  }, [dataPolicy, pathname, redirectProviderFromDashboard, router]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    return subscribeToSessionEnd(() => {
      clearWorkspaceSessionCache();
      setData(null);
      setWorkspaceBootstrap(null);
      setSessionUser(null);
      setError(null);
      setRequiresSignIn(true);
      router.replace("/login");
    });
  }, [router]);

  useEffect(() => {
    const handleSettingsChanged = () => {
      clearWorkspaceSessionCache();
      void loadWorkspace();
    };
    window.addEventListener(
      "clinicflow:workspace-settings-changed",
      handleSettingsChanged,
    );
    return () => window.removeEventListener(
      "clinicflow:workspace-settings-changed",
      handleSettingsChanged,
    );
  }, [loadWorkspace]);

  const hasRequiredRouteData = Boolean(
    data &&
      workspaceBootstrap &&
      (dataPolicy !== "schedule-bootstrap" || data.dataScope === "schedule"),
  );
  const gate = resolveWorkspaceGate({
    requiresSignIn,
    hasData: hasRequiredRouteData,
    hasError: Boolean(error),
  });

  if (gate === "unavailable") {
    return <WorkspaceUnavailable onRetry={() => void loadWorkspace()} />;
  }

  if (
    gate === "loading" &&
    data &&
    workspaceBootstrap &&
    sessionUser
  ) {
    return (
      <WorkspaceProvider
        initialData={data}
        initialSessionUser={sessionUser}
        initialWorkspaceBootstrap={workspaceBootstrap}
        key={`${workspaceBootstrap.context.organization.id}:${data.dataScope ?? "unknown"}`}
        todayDateKey={todayDateKey}
      >
        <QuickBookProvider>
          <SecureSignOutProvider>
            <WorkspaceShell>
              <WorkspaceContentSkeleton
                label="Loading schedule references"
                pathname={pathname}
              />
            </WorkspaceShell>
          </SecureSignOutProvider>
        </QuickBookProvider>
      </WorkspaceProvider>
    );
  }

  if (gate === "redirecting" || gate === "loading") {
    return (
      <WorkspaceShellSkeleton
        label={gate === "redirecting" ? "Redirecting to sign in" : "Loading secure clinic data"}
        pathname={pathname}
      />
    );
  }

  return (
    <WorkspaceProvider
      initialData={data!}
      initialSessionUser={sessionUser!}
      initialWorkspaceBootstrap={workspaceBootstrap!}
      key={`${workspaceBootstrap!.context.organization.id}:${data!.dataScope ?? "unknown"}`}
      todayDateKey={todayDateKey}
    >
      <QuickBookProvider>
        <SecureSignOutProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </SecureSignOutProvider>
      </QuickBookProvider>
    </WorkspaceProvider>
  );
}

function WorkspaceUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
      <section
        aria-labelledby="workspace-unavailable-title"
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--card-shadow)]"
      >
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Workspace unavailable
        </p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--foreground)]" id="workspace-unavailable-title">
          We could not load clinic data
        </h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          No local or sample data is shown while the secure clinic API is unavailable.
        </p>
        <button
          className="mt-5 rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-strong)] focus-visible:outline-none"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}

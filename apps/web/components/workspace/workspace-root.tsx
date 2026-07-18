"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { KoiPageLoader } from "@/components/koi-loader";
import { WorkspaceProvider } from "@/components/workspace/app-state";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { apiFetchJson, SESSION_TOKEN_STORAGE_KEY, withAuthHeaders } from "@/lib/api-client";
import type { OperationalData } from "@/lib/database-data";
import { resolveWorkspaceGate } from "@/lib/workspace-access";

export function WorkspaceRoot({
  children,
  todayDateKey,
}: {
  children: ReactNode;
  todayDateKey: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<OperationalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresSignIn, setRequiresSignIn] = useState(false);

  const loadWorkspace = useCallback(async () => {
    const token = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (!token) {
      setRequiresSignIn(true);
      router.replace("/login");
      return;
    }

    setRequiresSignIn(false);
    setError(null);
    try {
      const response = await apiFetchJson<OperationalData>(
        "/operational-data",
        withAuthHeaders(token, { cache: "no-store" }),
      );
      setData(response);
    } catch {
      setData(null);
      setError(
        "Clinic data is temporarily unavailable. Check your connection and try again.",
      );
    }
  }, [router]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const gate = resolveWorkspaceGate({
    requiresSignIn,
    hasData: Boolean(data),
    hasError: Boolean(error),
  });

  if (gate === "unavailable") {
    return <WorkspaceUnavailable onRetry={() => void loadWorkspace()} />;
  }

  if (gate === "redirecting" || gate === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <KoiPageLoader
          label={gate === "redirecting" ? "Redirecting to sign in" : "Loading secure clinic data"}
        />
      </div>
    );
  }

  return (
    <WorkspaceProvider initialData={data!} todayDateKey={todayDateKey}>
      <WorkspaceShell>{children}</WorkspaceShell>
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

"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Button, Panel } from "@/components/ui";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Panel className="rounded-xl">
      <div className="p-4">
        <div className="text-sm text-[var(--text-muted)]">{label}</div>
        <div className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{value}</div>
        {hint ? <div className="mt-1 text-sm text-[var(--text-muted)]">{hint}</div> : null}
      </div>
    </Panel>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  actionHref,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-sm">
      <div className="font-medium text-[var(--foreground)]">{title}</div>
      <p className="mt-2 max-w-xl leading-6 text-[var(--text-muted)]">{body}</p>
      {actionLabel ? (
        <div className="mt-4">
          {actionHref ? (
            <Link href={actionHref}>
              <Button>{actionLabel}</Button>
            </Link>
          ) : (
            <Button onClick={onAction}>{actionLabel}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Modal({
  children,
  onClose,
  title,
  subtitle,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm">
      <div className="h-[100dvh] w-full overflow-auto rounded-none border-0 bg-[var(--surface)] shadow-[var(--popover-shadow)] sm:max-h-[90vh] sm:max-w-3xl sm:rounded-xl sm:border sm:border-[var(--border)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p> : null}
          </div>
          <Button onClick={onClose} variant="ghost">
            Close
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClassName =
  "h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] outline-none";

export const textareaClassName =
  "min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none";

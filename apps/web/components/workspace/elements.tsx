"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

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
  children?: ReactNode;
  onClose: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <Drawer context={subtitle} onClose={onClose} title={title}>
      {children}
    </Drawer>
  );
}

export function Drawer({
  children,
  closeDisabled = false,
  context,
  hidden = false,
  onClose,
  stepLabel,
  title,
  width = "default",
}: {
  children?: ReactNode;
  closeDisabled?: boolean;
  context?: string;
  hidden?: boolean;
  onClose: () => void;
  stepLabel?: string;
  title: string;
  width?: "default" | "wide";
}) {
  const titleId = useId();
  const contextId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (hidden) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const preferredFocus = contentRef.current?.querySelector<HTMLElement>(
        "[data-drawer-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]",
      );
      (preferredFocus ?? panelRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [hidden]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!closeDisabled) {
        onClose();
      }
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }

    const focusableElements = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("aria-hidden"));

    if (focusableElements.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (hidden) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        aria-label={`Close ${title}`}
        className="absolute inset-0 bg-slate-950/30"
        disabled={closeDisabled}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-describedby={context ? contextId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`absolute inset-x-0 bottom-0 flex max-h-[min(92dvh,900px)] w-full flex-col rounded-t-2xl bg-[var(--surface)] shadow-[0_-16px_40px_rgba(15,23,42,0.2)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-none sm:shadow-[-16px_0_40px_rgba(15,23,42,0.2)] ${
          width === "wide" ? "sm:w-[min(720px,100vw)]" : "sm:w-[480px]"
        }`}
        data-testid="workspace-drawer"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="shrink-0 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-bold text-[var(--foreground)]" id={titleId}>
              {title}
            </h2>
            <button
              aria-label="Close"
              className="flex size-7 items-center justify-center rounded-md bg-[var(--sidebar)] text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-50"
              disabled={closeDisabled}
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          {context ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]" id={contextId}>
              {context}
            </p>
          ) : null}
          {stepLabel ? (
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-[var(--accent)]">
              {stepLabel}
            </p>
          ) : null}
        </header>
        <div
          className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto p-5"
          ref={contentRef}
        >
          {children}
        </div>
      </section>
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

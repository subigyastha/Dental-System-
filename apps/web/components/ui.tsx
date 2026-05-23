import { clsx } from "clsx";
import type { ReactNode } from "react";

import type { AppointmentStatus, Priority } from "@/lib/domain";
import { KoiButtonLoader } from "@/components/koi-loader";

export function Button({
  children,
  variant = "primary",
  className,
  disabled,
  loading,
  loadingLabel,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]",
        variant === "secondary" &&
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
        variant === "ghost" &&
          "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
        className,
      )}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {loading ? (
        <>
          <KoiButtonLoader />
          <span>{loadingLabel ?? "Loading..."}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Panel({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)]",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4">
          {title ? (
            <h2 className="text-[15px] font-semibold text-[var(--ink)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: AppointmentStatus }) {
  const tone = {
    Scheduled: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
    Confirmed: "bg-[var(--accent-soft)] text-[var(--brand-strong)]",
    CheckedIn: "bg-[var(--secondary-surface)] text-[var(--secondary-text)]",
    InProgress: "bg-[var(--surface-strong)] text-[var(--brand)]",
    Completed: "bg-[var(--accent-soft)] text-[var(--brand-strong)]",
    Cancelled: "bg-[var(--danger-soft)] text-[var(--danger)]",
    NoShow: "bg-[var(--danger-soft)] text-[var(--danger)]",
    Rescheduled: "bg-[var(--secondary-surface)] text-[var(--secondary-text)]",
    FollowUpRequired: "bg-[var(--danger-soft)] text-[var(--danger)]",
  }[status];

  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
      {status.replace(/([A-Z])/g, " $1").trim()}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const tone = {
    Low: "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]",
    Normal: "border-[var(--brand)] bg-white text-[var(--brand)]",
    High: "border-[var(--secondary-accent)] bg-[var(--secondary-surface)] text-[var(--secondary-text)]",
    Urgent: "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]",
  }[priority];

  return (
    <span
      className={clsx(
        "rounded-full border bg-white px-2.5 py-1 text-xs font-semibold",
        tone,
      )}
    >
      {priority}
    </span>
  );
}

export function ProgressBar({
  value,
  color = "var(--accent)",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(value, 100)}%`, background: color }}
      />
    </div>
  );
}

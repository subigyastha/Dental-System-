"use client";

import { CalendarPlus2, ChevronRight, Home, MoreHorizontal, Plus, Wallet } from "lucide-react";

type MobileWorkspaceBottomNavProps = {
  active: "overview" | "schedule" | "book" | "billing" | "more";
  canViewBilling: boolean;
  scheduleLabel: string;
  onBilling: () => void;
  onBook: () => void;
  onMore: () => void;
  onOverview: () => void;
  onSchedule: () => void;
};

export function MobileWorkspaceBottomNav({
  active,
  canViewBilling,
  scheduleLabel,
  onBilling,
  onBook,
  onMore,
  onOverview,
  onSchedule,
}: MobileWorkspaceBottomNavProps) {
  const items: Array<{
    active?: boolean;
    disabled?: boolean;
    icon: typeof Home;
    label: string;
    onClick: () => void;
    primary?: boolean;
  }> = [
    { active: active === "overview", icon: Home, label: "Overview", onClick: onOverview },
    {
      active: active === "schedule",
      icon: CalendarPlus2,
      label: scheduleLabel,
      onClick: onSchedule,
    },
    { active: active === "book", icon: Plus, label: "Book", onClick: onBook, primary: true },
    {
      active: active === "billing",
      disabled: !canViewBilling,
      icon: Wallet,
      label: "Billing",
      onClick: onBilling,
    },
    { active: active === "more", icon: MoreHorizontal, label: "More", onClick: onMore },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)]/96 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
      <div className="grid grid-cols-5 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`flex flex-col items-center justify-center rounded-xl px-2 py-2 text-[11px] font-medium ${
                item.primary
                  ? "bg-[var(--accent)] text-white"
                  : item.active
                    ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]"
                    : item.disabled
                      ? "text-[var(--text-muted)] opacity-45"
                      : "text-[var(--text-muted)]"
              }`}
              disabled={item.disabled}
              key={item.label}
              onClick={item.onClick}
              type="button"
            >
              <Icon size={18} />
              <span className="mt-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MobileWorkspaceMoreSheet({
  hasBillingAccess,
  hasMySchedule,
  onClose,
  onLogout,
  onNavigate,
}: {
  hasBillingAccess: boolean;
  hasMySchedule: boolean;
  onClose: () => void;
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--popover-shadow)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--border)]" />
        <div className="space-y-2">
          <MobileMoreSheetAction label="Patients" onClick={() => onNavigate("/patients")} />
          {hasMySchedule ? (
            <MobileMoreSheetAction label="My schedule" onClick={() => onNavigate("/my-schedule")} />
          ) : null}
          {hasBillingAccess ? (
            <MobileMoreSheetAction label="Billing" onClick={() => onNavigate("/billing")} />
          ) : null}
          <MobileMoreSheetAction label="Settings" onClick={() => onNavigate("/settings")} />
          <button
            className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-4 text-left text-[var(--danger)]"
            onClick={onLogout}
            type="button"
          >
            <span className="font-medium">Sign out</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileMoreSheetAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-4 text-left"
      onClick={onClick}
      type="button"
    >
      <span className="font-medium text-[var(--foreground)]">{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}

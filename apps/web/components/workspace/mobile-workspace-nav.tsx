"use client";

import { CalendarDays, ChevronRight, MoreHorizontal, Plus, X } from "lucide-react";
import { useEffect } from "react";

type MobileWorkspaceBottomNavProps = {
  active: "schedule" | "book" | "more";
  canBook: boolean;
  onBook: () => void;
  onMore: () => void;
  onSchedule: () => void;
};

export function MobileWorkspaceBottomNav({
  active,
  canBook,
  onBook,
  onMore,
  onSchedule,
}: MobileWorkspaceBottomNavProps) {
  const items: Array<{
    active?: boolean;
    icon: typeof CalendarDays;
    label: string;
    onClick: () => void;
    primary?: boolean;
  }> = [
    {
      active: active === "schedule",
      icon: CalendarDays,
      label: "Schedule",
      onClick: onSchedule,
    },
    ...(canBook
      ? [{ active: active === "book", icon: Plus, label: "Book", onClick: onBook, primary: true }]
      : []),
    { active: active === "more", icon: MoreHorizontal, label: "More", onClick: onMore },
  ];

  return (
    <nav
      aria-label="Mobile workspace navigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)]/96 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
    >
      <div className={`grid gap-2 ${canBook ? "grid-cols-3" : "grid-cols-2"}`}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-current={item.active ? "page" : undefined}
              className={`flex min-h-11 flex-col items-center justify-center rounded-md px-2 py-2 text-xs font-medium ${
                item.primary
                  ? "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]"
                  : item.active
                    ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--color-hover)]"
              }`}
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
    </nav>
  );
}

export function MobileWorkspaceMoreSheet({
  hasBillingAccess,
  hasInventoryAccess,
  hasMySchedule,
  hasArchiveAccess,
  hasSettingsAccess,
  hasStaffAccess,
  isLogoutBlocked,
  isLoggingOut,
  onClose,
  onLogout,
  onNavigate,
}: {
  hasBillingAccess: boolean;
  hasInventoryAccess: boolean;
  hasMySchedule: boolean;
  hasArchiveAccess: boolean;
  hasSettingsAccess: boolean;
  hasStaffAccess: boolean;
  isLogoutBlocked: boolean;
  isLoggingOut: boolean;
  onClose: () => void;
  onLogout: () => void;
  onNavigate: (href: string) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose}>
      <div
        aria-label="More workspace options"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--popover-shadow)]"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="h-1.5 w-12 rounded-full bg-[var(--border)]" />
          <button
            aria-label="Close more options"
            className="flex size-11 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--color-hover)]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="space-y-2">
          <MobileMoreSheetAction label="Clients" onClick={() => onNavigate("/clients")} />
          {hasMySchedule ? (
            <MobileMoreSheetAction label="My schedule" onClick={() => onNavigate("/my-schedule")} />
          ) : null}
          {hasBillingAccess ? (
            <MobileMoreSheetAction label="Finance" onClick={() => onNavigate("/billing")} />
          ) : null}
          {hasInventoryAccess ? (
            <MobileMoreSheetAction label="Inventory" onClick={() => onNavigate("/inventory")} />
          ) : null}
          {hasStaffAccess ? (
            <MobileMoreSheetAction label="Staff" onClick={() => onNavigate("/staff")} />
          ) : null}
          {hasArchiveAccess ? (
            <MobileMoreSheetAction label="Archive center" onClick={() => onNavigate("/archive")} />
          ) : null}
          {hasSettingsAccess ? (
            <MobileMoreSheetAction label="Settings" onClick={() => onNavigate("/settings")} />
          ) : null}
          <button
            className="flex min-h-11 w-full items-center justify-between rounded-md border border-[var(--border)] px-4 py-3 text-left text-[var(--danger)] disabled:cursor-wait disabled:opacity-60"
            disabled={isLogoutBlocked || isLoggingOut}
            onClick={onLogout}
            type="button"
          >
            <span className="font-medium">
              {isLoggingOut ? "Signing out…" : isLogoutBlocked ? "Finishing booking…" : "Sign out"}
            </span>
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
      className="flex min-h-11 w-full items-center justify-between rounded-md border border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--color-hover)]"
      onClick={onClick}
      type="button"
    >
      <span className="font-medium text-[var(--foreground)]">{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}

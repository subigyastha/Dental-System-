"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ArchiveRestore,
  CalendarDays,
  CircleDollarSign,
  CircleUserRound,
  LayoutGrid,
  LogOut,
  Settings,
  Stethoscope,
  UserSquare2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { CalendarModeToggle } from "@/components/calendar-ui";
import { KoiPageLoader } from "@/components/koi-loader";
import {
  MobileWorkspaceBottomNav,
  MobileWorkspaceMoreSheet,
} from "@/components/workspace/mobile-workspace-nav";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import type { SessionUser } from "@/lib/domain";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  roles?: SessionUser["role"][];
  requiresProvider?: boolean;
};

type NavGroup = {
  items: NavItem[];
  label: string;
};

const financeRoles: SessionUser["role"][] = [
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
];
const practiceRoles: SessionUser["role"][] = ["Owner", "Admin", "Manager"];
const archiveRoles: SessionUser["role"][] = ["Owner", "Admin"];

const navigationGroups: NavGroup[] = [
  {
    label: "Today",
    items: [
      { href: "/dashboard", icon: LayoutGrid, label: "Overview" },
      { href: "/my-schedule", icon: Stethoscope, label: "My schedule", requiresProvider: true },
    ],
  },
  {
    label: "Care",
    items: [
      { href: "/reservations", icon: CalendarDays, label: "Reservations" },
      { href: "/patients", icon: UserSquare2, label: "Clients" },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/billing", icon: CircleDollarSign, label: "Billing", roles: financeRoles }],
  },
  {
    label: "Practice",
    items: [
      { href: "/staff", icon: Users, label: "Staff", roles: practiceRoles },
      { href: "/archive", icon: ArchiveRestore, label: "Archive center", roles: archiveRoles },
      { href: "/settings", icon: Settings, label: "Settings", roles: practiceRoles },
    ],
  },
];

function isVisible(item: NavItem, user: SessionUser) {
  if (item.requiresProvider && !user.providerId) {
    return false;
  }
  return !item.roles || item.roles.includes(user.role);
}

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    calendarMode,
    setCalendarMode,
    data,
    sessionUser,
    isAuthenticating,
    logout,
    toast,
    clearToast,
  } = useWorkspaceApp();
  const [activePopover, setActivePopover] = useState<"notifications" | "profile" | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => clearToast(), 3000);
    return () => window.clearTimeout(timer);
  }, [clearToast, toast]);

  const visibleNavigationGroups = useMemo(() => {
    if (!sessionUser) {
      return [];
    }

    return navigationGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => isVisible(item, sessionUser)) }))
      .filter((group) => group.items.length > 0);
  }, [sessionUser]);
  const visibleNavItems = visibleNavigationGroups.flatMap((group) => group.items);
  const notifications = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayKey = today.toISOString().slice(0, 10);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const upcomingAppointments = data.appointments.filter((appointment) => {
      const dateKey = appointment.startsAtIso.slice(0, 10);
      return dateKey === todayKey || dateKey === tomorrowKey;
    });
    const openFollowUps = data.followUps.filter((task) => task.status !== "Done").slice(0, 3);
    return [
      ...openFollowUps.map((task) => ({
        id: task.id,
        label: task.summary,
        sublabel: task.nextAction,
      })),
      ...upcomingAppointments.slice(0, 3).map((appointment) => ({
        id: appointment.id,
        label: "Upcoming appointment",
        sublabel: appointment.startsAtIso.slice(0, 16).replace("T", " "),
      })),
    ];
  }, [data.appointments, data.followUps]);

  if (isAuthenticating || !sessionUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <KoiPageLoader label="Loading workspace" />
      </div>
    );
  }

  const hasModuleOwnedMobileNav =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/reservations") ||
    pathname.startsWith("/my-schedule");
  const hasBillingAccess = financeRoles.includes(sessionUser.role);
  const hasSettingsAccess = practiceRoles.includes(sessionUser.role);
  const hasArchiveAccess = archiveRoles.includes(sessionUser.role);
  const scheduleHref = sessionUser.providerId ? "/my-schedule" : "/reservations";
  const pageTitle = visibleNavItems.find((item) => isCurrentPath(pathname, item.href))?.label ?? "Workspace";
  const locationName = data.locations[0]?.name;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen lg:grid-cols-[56px_272px_minmax(0,1fr)]">
        <aside
          aria-label="Workspace utility rail"
          className="hidden border-r border-[var(--border)] bg-[var(--surface)] py-3 lg:flex lg:flex-col lg:items-center"
        >
          <div className="flex size-9 items-center justify-center rounded-md bg-[var(--color-selected)]" title={data.organization.name}>
            <Image alt="DentalFlow workspace" className="size-6" height={24} src="/just-icon.svg" width={24} />
          </div>

          <nav aria-label="Global destinations" className="mt-6 flex flex-1 flex-col items-center gap-2">
            {visibleNavItems.slice(0, 4).map((item) => {
              const Icon = item.icon;
              const active = isCurrentPath(pathname, item.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`flex size-9 items-center justify-center rounded-md transition-colors ${
                    active
                      ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--foreground)]"
                  }`}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <Icon aria-hidden="true" size={18} />
                </Link>
              );
            })}
          </nav>

          <button
            aria-label="Open profile menu"
            className="flex size-9 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--foreground)]"
            onClick={() => setActivePopover("profile")}
            title="Profile menu"
            type="button"
          >
            <CircleUserRound aria-hidden="true" size={19} />
          </button>
        </aside>

        <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-5 lg:flex lg:flex-col">
          <div className="border-b border-[var(--border)] px-2 pb-4">
            <div className="text-sm font-semibold text-[var(--foreground)]">{data.organization.name}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {locationName ? `Location: ${locationName}` : "Clinic workspace"}
            </div>
          </div>

          <nav aria-label="Workspace navigation" className="mt-4 flex-1 space-y-5">
            {visibleNavigationGroups.map((group) => (
              <section aria-labelledby={`nav-group-${group.label}`} key={group.label}>
                <h2
                  className="px-2 text-xs font-semibold text-[var(--text-muted)]"
                  id={`nav-group-${group.label}`}
                >
                  {group.label}
                </h2>
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isCurrentPath(pathname, item.href);
                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-9 items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[var(--color-selected)] font-medium text-[var(--color-primary-hover)]"
                            : "text-[var(--foreground)] hover:bg-[var(--color-hover)]"
                        }`}
                        href={item.href}
                        key={item.href}
                      >
                        <Icon aria-hidden="true" size={16} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          <div className="border-t border-[var(--border)] px-2 pt-4">
            <div className="text-sm font-medium text-[var(--foreground)]">{sessionUser.name}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{sessionUser.role}</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
            <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 lg:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold leading-7 text-[var(--foreground)]">{pageTitle}</h1>
                <div className="truncate text-xs text-[var(--text-muted)]">
                  {data.organization.name}
                  {locationName ? ` · ${locationName}` : ""}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <CalendarModeToggle mode={calendarMode} onChange={setCalendarMode} />
                <div className="relative">
                  <button
                    aria-expanded={activePopover === "notifications"}
                    aria-label="Open notifications"
                    className="flex size-11 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--foreground)] lg:size-9"
                    onClick={() =>
                      setActivePopover((current) => (current === "notifications" ? null : "notifications"))
                    }
                    title="Notifications"
                    type="button"
                  >
                    <Bell aria-hidden="true" size={17} />
                  </button>
                  {activePopover === "notifications" ? (
                    <PopoverCard title="Notifications">
                      {notifications.length ? (
                        notifications.map((item) => (
                          <div className="border-b border-[var(--border)] px-3 py-3 last:border-b-0" key={item.id}>
                            <div className="text-sm font-medium text-[var(--foreground)]">{item.label}</div>
                            <div className="mt-1 text-xs text-[var(--text-muted)]">{item.sublabel}</div>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-3 text-sm text-[var(--text-muted)]">Nothing urgent right now.</div>
                      )}
                    </PopoverCard>
                  ) : null}
                </div>
                <div className="relative">
                  <button
                    aria-expanded={activePopover === "profile"}
                    aria-label="Open profile menu"
                    className="flex size-11 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--foreground)] lg:size-9"
                    onClick={() => setActivePopover((current) => (current === "profile" ? null : "profile"))}
                    title="Profile menu"
                    type="button"
                  >
                    <CircleUserRound aria-hidden="true" size={17} />
                  </button>
                  {activePopover === "profile" ? (
                    <PopoverCard title="Profile">
                      <div className="px-3 py-3">
                        <div className="text-sm font-medium text-[var(--foreground)]">{sessionUser.name}</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{sessionUser.role}</div>
                        <div className="mt-3 text-xs text-[var(--text-muted)]">{sessionUser.email}</div>
                        <button
                          className="mt-4 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                          onClick={logout}
                          type="button"
                        >
                          <LogOut aria-hidden="true" size={16} />
                          Sign out
                        </button>
                      </div>
                    </PopoverCard>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 pb-24 lg:px-6 lg:py-6">{children}</main>
        </div>
      </div>

      {!hasModuleOwnedMobileNav ? (
        <>
          {mobileMoreOpen ? (
            <MobileWorkspaceMoreSheet
              hasBillingAccess={hasBillingAccess}
              hasMySchedule={Boolean(sessionUser.providerId)}
              hasArchiveAccess={hasArchiveAccess}
              hasSettingsAccess={hasSettingsAccess}
              onClose={() => setMobileMoreOpen(false)}
              onLogout={logout}
              onNavigate={(href) => {
                setMobileMoreOpen(false);
                router.push(href);
              }}
            />
          ) : null}
          <MobileWorkspaceBottomNav
            active={pathname.startsWith("/reservations") || pathname.startsWith("/my-schedule") ? "schedule" : "more"}
            onBook={() => router.push("/reservations?book=1")}
            onMore={() => setMobileMoreOpen(true)}
            onSchedule={() => router.push(scheduleHref)}
          />
        </>
      ) : null}

      {toast ? (
        <div
          aria-live="polite"
          className="fixed bottom-24 right-4 z-40 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm shadow-[var(--card-shadow)] lg:bottom-4"
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function PopoverCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
        {title}
      </div>
      {children}
    </div>
  );
}

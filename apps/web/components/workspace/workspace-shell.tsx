"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ArchiveRestore,
  CalendarDays,
  CalendarPlus2,
  CircleDollarSign,
  CircleUserRound,
  LayoutGrid,
  LogOut,
  PackageSearch,
  Settings,
  Stethoscope,
  UserSquare2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { CalendarModeToggle } from "@/components/calendar-ui";
import { WorkspaceShellSkeleton } from "@/components/workspace/workspace-shell-skeleton";
import {
  MobileWorkspaceBottomNav,
  MobileWorkspaceMoreSheet,
} from "@/components/workspace/mobile-workspace-nav";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { QuickBookSurface } from "@/components/workspace/quick-book-surface";
import { useQuickBook } from "@/components/workspace/quick-book-provider";
import {
  signOutButtonLabel,
  useSecureSignOut,
} from "@/components/workspace/secure-sign-out";
import type { SessionUser } from "@/lib/domain";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  roles?: SessionUser["role"][];
  requiresProvider?: boolean;
  requiresInventory?: boolean;
  requiresStaff?: boolean;
  requiresSettings?: boolean;
};

const financeRoles: SessionUser["role"][] = [
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
  "Finance",
];
const archiveRoles: SessionUser["role"][] = ["Owner", "Admin"];

const navigationItems: NavItem[] = [
  { href: "/dashboard", icon: LayoutGrid, label: "Overview" },
  { href: "/my-schedule", icon: Stethoscope, label: "My schedule", requiresProvider: true },
  { href: "/reservations", icon: CalendarDays, label: "Reservations" },
  { href: "/clients", icon: UserSquare2, label: "Clients" },
  { href: "/billing", icon: CircleDollarSign, label: "Finance", roles: financeRoles },
  { href: "/inventory", icon: PackageSearch, label: "Inventory", requiresInventory: true },
  { href: "/staff", icon: Users, label: "Staff", requiresStaff: true },
  { href: "/archive", icon: ArchiveRestore, label: "Archive center", roles: archiveRoles },
  { href: "/settings", icon: Settings, label: "Settings", requiresSettings: true },
];

function isVisible(
  item: NavItem,
  user: SessionUser,
  canAccessInventory: boolean,
  canAccessStaff: boolean,
  canAccessSettings: boolean,
) {
  if (item.requiresProvider && !user.providerId) {
    return false;
  }
  if (item.requiresInventory && !canAccessInventory) {
    return false;
  }
  if (item.requiresStaff && !canAccessStaff) {
    return false;
  }
  if (item.requiresSettings && !canAccessSettings) {
    return false;
  }
  const effectiveRoles = user.effectiveRoles?.length ? user.effectiveRoles : [user.role];
  return !item.roles || effectiveRoles.some((role) => item.roles?.includes(role));
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
    toast,
    clearToast,
    workspaceBootstrap,
  } = useWorkspaceApp();
  const { canOpen: canQuickBook, openQuickBook } = useQuickBook();
  const { isBlocked, isSigningOut, requestSignOut } = useSecureSignOut();
  const [activePopover, setActivePopover] = useState<"notifications" | "profile" | null>(null);
  const [isAttentionHovered, setIsAttentionHovered] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => clearToast(), 3000);
    return () => window.clearTimeout(timer);
  }, [clearToast, toast]);

  const visibleNavItems = useMemo(() => {
    if (!sessionUser) {
      return [];
    }

    return navigationItems.filter((item) =>
      isVisible(
        item,
        sessionUser,
        workspaceBootstrap.context.capabilities.canAccessInventory,
        workspaceBootstrap.context.capabilities.canAccessStaff,
        workspaceBootstrap.context.capabilities.canAccessSettings,
      ),
    );
  }, [sessionUser, workspaceBootstrap.context.capabilities.canAccessInventory, workspaceBootstrap.context.capabilities.canAccessSettings, workspaceBootstrap.context.capabilities.canAccessStaff]);

  const notifications = useMemo(() => {
    if (data.dataScope === "shell") {
      return [];
    }
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
  }, [data.appointments, data.dataScope, data.followUps]);
  const attentionUsesRouteData = data.dataScope === "shell";

  if (isAuthenticating || !sessionUser) {
    return <WorkspaceShellSkeleton label="Loading workspace" pathname={pathname} />;
  }

  const hasModuleOwnedMobileNav =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/reservations") ||
    pathname.startsWith("/my-schedule");
  const sessionRoles = sessionUser.effectiveRoles?.length ? sessionUser.effectiveRoles : [sessionUser.role];
  const hasBillingAccess = sessionRoles.some((role) => financeRoles.includes(role));
  const hasSettingsAccess = workspaceBootstrap.context.capabilities.canAccessSettings;
  const hasArchiveAccess = sessionRoles.some((role) => archiveRoles.includes(role));
  const hasInventoryAccess = workspaceBootstrap.context.capabilities.canAccessInventory;
  const hasStaffAccess = workspaceBootstrap.context.capabilities.canAccessStaff;
  const scheduleHref = sessionUser.providerId ? "/my-schedule" : "/reservations";
  const pageTitle = visibleNavItems.find((item) => isCurrentPath(pathname, item.href))?.label ?? "Workspace";
  const locationName = workspaceBootstrap.locations[0]?.name ?? data.locations[0]?.name;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]" data-workspace-shell>
      <div className="grid min-h-screen lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside aria-label="Workspace navigation" className="sticky top-0 hidden h-screen min-h-0 overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-5 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-2 pb-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-selected)]">
              <Image alt="" aria-hidden="true" className="size-6" height={24} src="/just-icon.svg" width={24} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--foreground)]">{data.organization.name}</div>
              <div className="mt-1 truncate text-xs text-[var(--text-muted)]">
                {locationName ? `Location: ${locationName}` : "Clinic workspace"}
              </div>
            </div>
          </div>

          <nav aria-label="Workspace navigation" className="mt-4 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = isCurrentPath(pathname, item.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
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
          </nav>

          <div className="space-y-1 border-t border-[var(--border)] pt-3">
            <div
              className="relative"
              onMouseEnter={() => setIsAttentionHovered(true)}
              onMouseLeave={() => setIsAttentionHovered(false)}
            >
              <button
                aria-expanded={activePopover === "notifications"}
                aria-label={`Open attention center${notifications.length ? `, ${notifications.length} items` : ""}`}
                className={`flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  activePopover === "notifications" || isAttentionHovered
                    ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]"
                    : "text-[var(--foreground)] hover:bg-[var(--color-hover)]"
                }`}
                onClick={() =>
                  setActivePopover((current) => (current === "notifications" ? null : "notifications"))
                }
                type="button"
              >
                <Bell aria-hidden="true" size={16} />
                <span className="flex-1">Attention</span>
                {notifications.length ? (
                  <span className="rounded-full bg-[var(--color-danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {notifications.length}
                  </span>
                ) : null}
              </button>
              {activePopover === "notifications" || isAttentionHovered ? (
                <SidebarPopover title={activePopover === "notifications" ? "Attention center" : "Attention preview"}>
                  {attentionUsesRouteData ? (
                    <div className="px-3 py-3 text-sm text-[var(--text-muted)]">
                      Open Overview for the current agenda and follow-ups.
                    </div>
                  ) : notifications.length ? (
                    notifications.slice(0, activePopover === "notifications" ? undefined : 3).map((item) => (
                      <div className="border-b border-[var(--border)] px-3 py-3 last:border-b-0" key={item.id}>
                        <div className="text-sm font-medium text-[var(--foreground)]">{item.label}</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{item.sublabel}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-[var(--text-muted)]">Nothing needs attention right now.</div>
                  )}
                  {activePopover !== "notifications" && notifications.length > 3 ? (
                    <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      Click Attention to keep the full list open.
                    </div>
                  ) : null}
                </SidebarPopover>
              ) : null}
            </div>

            <div className="relative">
              <button
                aria-expanded={activePopover === "profile"}
                aria-label="Open profile menu"
                className="flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--color-hover)]"
                onClick={() => setActivePopover((current) => (current === "profile" ? null : "profile"))}
                type="button"
              >
                <CircleUserRound aria-hidden="true" size={16} />
                <span className="min-w-0 flex-1 truncate">{sessionUser.name}</span>
              </button>
              {activePopover === "profile" ? (
                <ProfileMenu
                  inSidebar
                  isLogoutBlocked={isBlocked}
                  isLoggingOut={isSigningOut}
                  onLogout={requestSignOut}
                  sessionUser={sessionUser}
                />
              ) : null}
            </div>
            <button
              aria-label={signOutButtonLabel({ isBlocked, isSigningOut })}
              className="flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)] disabled:cursor-wait disabled:opacity-60"
              disabled={isBlocked || isSigningOut}
              onClick={requestSignOut}
              type="button"
            >
              <LogOut aria-hidden="true" size={16} />
              <span>{signOutButtonLabel({ isBlocked, isSigningOut })}</span>
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
            <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 lg:px-6">
              <div className="min-w-0">
                <h1 className="sr-only">{pageTitle}</h1>
                <div className="truncate text-sm font-medium text-[var(--foreground)]">
                  {data.organization.name}
                </div>
                {locationName ? (
                  <div className="truncate text-xs text-[var(--text-muted)]">{locationName}</div>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {canQuickBook ? (
                  <button
                    className="hidden h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] lg:inline-flex"
                    onClick={() => openQuickBook()}
                    type="button"
                  >
                    <CalendarPlus2 aria-hidden="true" size={16} />
                    Book appointment
                  </button>
                ) : null}
                <CalendarModeToggle mode={calendarMode} onChange={setCalendarMode} />
                <div className="relative lg:hidden">
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
                      {attentionUsesRouteData ? (
                        <div className="px-3 py-3 text-sm text-[var(--text-muted)]">
                          Open Overview for the current agenda and follow-ups.
                        </div>
                      ) : notifications.length ? (
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
                <div className="relative lg:hidden">
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
                    <ProfileMenu
                      isLogoutBlocked={isBlocked}
                      isLoggingOut={isSigningOut}
                      onLogout={requestSignOut}
                      sessionUser={sessionUser}
                    />
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
              hasInventoryAccess={hasInventoryAccess}
              hasStaffAccess={hasStaffAccess}
              hasMySchedule={Boolean(sessionUser.providerId)}
              hasArchiveAccess={hasArchiveAccess}
              hasSettingsAccess={hasSettingsAccess}
              onClose={() => setMobileMoreOpen(false)}
              isLogoutBlocked={isBlocked}
              isLoggingOut={isSigningOut}
              onLogout={requestSignOut}
              onNavigate={(href) => {
                setMobileMoreOpen(false);
                router.push(href);
              }}
            />
          ) : null}
          <MobileWorkspaceBottomNav
            active={pathname.startsWith("/reservations") || pathname.startsWith("/my-schedule") ? "schedule" : "more"}
            canBook={canQuickBook}
            onBook={() => openQuickBook()}
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
      <QuickBookSurface />
    </div>
  );
}

function PopoverCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 max-h-[calc(100dvh-5rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function SidebarPopover({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="absolute bottom-0 left-[calc(100%+0.75rem)] z-30 max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-19rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--popover-shadow)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function ProfileMenu({
  inSidebar = false,
  isLogoutBlocked,
  isLoggingOut,
  onLogout,
  sessionUser,
}: {
  inSidebar?: boolean;
  isLogoutBlocked: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
  sessionUser: SessionUser;
}) {
  const content = (
    <div className="px-3 py-3">
      <div className="text-sm font-medium text-[var(--foreground)]">{sessionUser.name}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{sessionUser.role}</div>
      <div className="mt-3 text-xs text-[var(--text-muted)]">{sessionUser.email}</div>
      <button
        className="mt-4 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
        disabled={isLogoutBlocked || isLoggingOut}
        onClick={onLogout}
        type="button"
      >
        <LogOut aria-hidden="true" size={16} />
        {signOutButtonLabel({ isBlocked: isLogoutBlocked, isSigningOut: isLoggingOut })}
      </button>
    </div>
  );

  if (inSidebar) {
    return <SidebarPopover title="Profile">{content}</SidebarPopover>;
  }

  return (
    <PopoverCard title="Profile">
      {content}
    </PopoverCard>
  );
}

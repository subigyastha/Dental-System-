"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CircleDollarSign,
  LayoutGrid,
  LogOut,
  Bell,
  CircleUserRound,
  Settings,
  Stethoscope,
  Users,
  UserSquare2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";

import { CalendarModeToggle } from "@/components/calendar-ui";
import { KoiPageLoader } from "@/components/koi-loader";
import { Button } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  roles?: string[];
  requiresProvider?: boolean;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/reservations", label: "Reservations", icon: CalendarDays },
  { href: "/my-schedule", label: "My schedule", icon: Stethoscope, requiresProvider: true },
  { href: "/patients", label: "Patients", icon: UserSquare2 },
  { href: "/staff", label: "Staff", icon: Users, roles: ["Owner", "Admin", "Manager"] },
  {
    href: "/billing",
    label: "Billing",
    icon: CircleDollarSign,
    roles: ["Owner", "Admin", "Manager", "Receptionist", "Scheduler"],
  },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["Owner", "Admin", "Manager"] },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => clearToast(), 3000);
    return () => window.clearTimeout(timer);
  }, [clearToast, toast]);

  const visibleNavItems = navItems.filter((item) => {
    if (item.requiresProvider && !sessionUser?.providerId) {
      return false;
    }
    if (item.roles && (!sessionUser || !item.roles.includes(sessionUser.role))) {
      return false;
    }
    return true;
  });
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
  const hasModuleOwnedMobileNav =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/reservations") ||
    pathname.startsWith("/my-schedule");

  if (isAuthenticating || !sessionUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <KoiPageLoader label="Loading workspace" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar)] px-4 py-5 text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 pb-5">
            <Image
              alt="Nepal Koi Tech"
              className="h-auto w-full"
              height={72}
              src="/with-text.svg"
              width={320}
            />
            <div className="mt-3 text-lg font-semibold">{data.organization.name}</div>
            <div className="mt-1 text-sm text-white/60">{data.organization.address ?? "Clinic workspace"}</div>
          </div>

          <nav className="mt-5 flex-1 space-y-1">
            {visibleNavItems.map((item) => {
              const active =
                pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                    active
                      ? "bg-white/12 text-white"
                      : "text-white/68 hover:bg-white/8 hover:text-white"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-white/10 pt-4">
            <div className="text-sm font-medium">{sessionUser.name}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.08em] text-white/50">
              {sessionUser.role}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
              <div>
                <div className="flex items-center gap-2">
                  <Image alt="Nepal Koi Tech" className="h-6 w-6" height={24} src="/just-icon.svg" width={24} />
                  <div className="text-sm font-medium text-[var(--foreground)]">{data.organization.name}</div>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {sessionUser.role} workspace
                </div>
              </div>

              <div className="flex items-center gap-2">
                <CalendarModeToggle mode={calendarMode} onChange={setCalendarMode} />
                <div className="relative">
                  <Button
                    onClick={() =>
                      setActivePopover((current) =>
                        current === "notifications" ? null : "notifications",
                      )
                    }
                    variant="ghost"
                  >
                    <Bell size={16} />
                  </Button>
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
                  <Button
                    onClick={() => setActivePopover((current) => (current === "profile" ? null : "profile"))}
                    variant="ghost"
                  >
                    <CircleUserRound size={16} />
                  </Button>
                  {activePopover === "profile" ? (
                    <PopoverCard title="Profile">
                      <div className="px-3 py-3">
                        <div className="text-sm font-medium text-[var(--foreground)]">{sessionUser.name}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
                          {sessionUser.role}
                        </div>
                        <div className="mt-3 text-xs text-[var(--text-muted)]">{sessionUser.email}</div>
                      </div>
                    </PopoverCard>
                  ) : null}
                </div>
                <Button onClick={logout} variant="ghost">
                  <LogOut size={16} />
                  Sign out
                </Button>
              </div>
            </div>

            <div
              className={`border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 lg:hidden ${
                hasModuleOwnedMobileNav ? "hidden" : ""
              }`}
            >
              <div className="flex gap-2 overflow-x-auto scrollbar-quiet">
                {visibleNavItems.map((item) => {
                  const active =
                    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <Link
                      className={`shrink-0 rounded-md px-3 py-2 text-sm ${
                        active
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                      }`}
                      href={item.href}
                      key={item.href}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-40 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm shadow-[var(--card-shadow)]">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function PopoverCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
        {title}
      </div>
      {children}
    </div>
  );
}

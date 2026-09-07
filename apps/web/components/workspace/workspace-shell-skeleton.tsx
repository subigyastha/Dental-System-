import clsx from "clsx";

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "animate-pulse rounded-md bg-[color:rgba(112,140,151,0.16)] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function WorkspaceShellSkeleton({
  label = "Loading secure clinic data",
  pathname = "/",
}: {
  label?: string;
  pathname?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="grid min-h-screen lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-5 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-2 pb-4">
            <SkeletonBlock className="size-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-3 w-40" />
            </div>
          </div>
          <div className="mt-4 flex-1 space-y-2">
            {[72, 84, 68, 76, 64, 70, 82].map((width, index) => (
              <div className="flex h-10 items-center gap-3 px-2.5" key={`${width}-${index}`}>
                <SkeletonBlock className="size-4 shrink-0" />
                <span aria-hidden="true" style={{ width: `${width}px` }}>
                  <SkeletonBlock className="h-3.5 w-full" />
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t border-[var(--border)] px-2 pt-4">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-36" />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="min-h-14 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 lg:px-6">
            <div className="flex min-h-10 items-center justify-between gap-4">
              <div className="space-y-2">
                <SkeletonBlock className="h-4 w-36" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
              <div className="flex items-center gap-2">
                <SkeletonBlock className="hidden h-9 w-36 lg:block" />
                <SkeletonBlock className="h-9 w-20" />
                <SkeletonBlock className="size-9 lg:hidden" />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 pb-24 lg:px-6 lg:py-6">
            <WorkspaceContentSkeleton label={label} pathname={pathname} />
          </main>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 grid h-16 grid-cols-4 border-t border-[var(--border)] bg-[var(--surface)] px-4 lg:hidden">
        {[0, 1, 2, 3].map((item) => (
          <div className="flex items-center justify-center" key={item}>
            <SkeletonBlock className="h-8 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceContentSkeleton({
  label = "Loading page data",
  pathname = "/",
}: {
  label?: string;
  pathname?: string;
}) {
  const scheduleRoute = pathname.startsWith("/reservations") || pathname.startsWith("/my-schedule");
  const listRoute = pathname.startsWith("/clients") || pathname.startsWith("/billing") || pathname.startsWith("/inventory");

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-48" />
        <SkeletonBlock className="h-4 w-full max-w-md" />
      </div>
      {scheduleRoute ? <ScheduleSkeleton /> : listRoute ? <ListSkeleton /> : <DashboardSkeleton />}
    </div>
  );
}

function ScheduleSkeleton() {
  return (
    <>
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <SkeletonBlock className="h-11 w-full rounded-full" />
        <div className="mt-4 flex items-center justify-between gap-4">
          <SkeletonBlock className="h-10 w-52" />
          <SkeletonBlock className="h-9 w-56" />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_320px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-[var(--border)]">
            {Array.from({ length: 28 }, (_, index) => (
              <SkeletonBlock className="min-h-20 rounded-none bg-[var(--surface-muted)]" key={index} />
            ))}
          </div>
        </div>
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <SkeletonBlock className="h-5 w-28" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-32 w-full" />
        </div>
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <SkeletonBlock className="h-11 w-full max-w-xl" />
      <div className="mt-5 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div className="flex items-center gap-4 border-b border-[var(--border)] py-3" key={row}>
            <SkeletonBlock className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-44" />
              <SkeletonBlock className="h-3 w-28" />
            </div>
            <SkeletonBlock className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" key={card}>
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-8 w-16" />
            <SkeletonBlock className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <SkeletonBlock className="h-80 w-full rounded-xl" />
        <SkeletonBlock className="h-80 w-full rounded-xl" />
      </div>
    </>
  );
}

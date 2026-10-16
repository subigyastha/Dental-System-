"use client";

import { clsx } from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui";
import {
  buildCalendarGrid,
  CALENDAR_MODES,
  type CalendarMode,
  dateKeyInTimeZone,
  getDualCalendarDay,
  isDateKeyWithinBounds,
  moveCalendarFocus,
  NEPAL_TIME_ZONE,
  shiftCalendarPage,
  toDateKey,
} from "@/lib/calendar";

export function CalendarModeToggle({
  mode,
  onChange,
  className,
}: {
  mode: CalendarMode;
  onChange: (mode: CalendarMode) => void;
  className?: string;
}) {
  return (
    <div
      aria-label="Date display"
      className={clsx(
        "calendar-mode-toggle flex h-10 overflow-hidden rounded-md border border-[var(--border)] bg-white p-1",
        className,
      )}
      role="group"
    >
      {CALENDAR_MODES.map((calendarMode) => (
        <button
          className={clsx(
            "rounded px-3 text-sm font-bold transition",
            mode === calendarMode
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)] hover:text-[var(--ink)]",
          )}
          aria-pressed={mode === calendarMode}
          key={calendarMode}
          onClick={() => onChange(calendarMode)}
          type="button"
        >
          {calendarMode}
        </button>
      ))}
    </div>
  );
}

export function DualDateDisplay({
  adDateKey,
  iso,
  mode,
  primaryClassName,
  secondaryClassName,
  variant = "long",
}: {
  adDateKey?: string;
  iso?: string;
  mode: CalendarMode;
  primaryClassName?: string;
  secondaryClassName?: string;
  variant?: "long" | "short";
}) {
  const normalizedAdDateKey = adDateKey ?? (iso ? toDateKey(iso) : "");
  const dual = normalizedAdDateKey ? getDualCalendarDay(normalizedAdDateKey) : null;

  if (!dual) {
    return null;
  }

  const primary = mode === "BS"
    ? variant === "short"
      ? dual.bsShort
      : dual.bsDate
    : variant === "short"
      ? dual.adShort
      : dual.adDate;
  const secondary = mode === "BS"
    ? variant === "short"
      ? dual.adShort
      : dual.adDate
    : variant === "short"
      ? dual.bsShort
      : dual.bsDate;

  return (
    <div className="space-y-1">
      <div className={clsx("font-semibold text-[var(--ink)]", primaryClassName)}>{primary}</div>
      <div className={clsx("text-sm text-[var(--text-muted)]", secondaryClassName)}>{secondary}</div>
    </div>
  );
}

export function AppointmentDateHeader({
  adDateKey,
  mode,
}: {
  adDateKey: string;
  mode: CalendarMode;
}) {
  return (
    <DualDateDisplay
      adDateKey={adDateKey}
      mode={mode}
      primaryClassName="text-2xl font-black"
      secondaryClassName="text-xs font-semibold uppercase tracking-[0.08em]"
    />
  );
}

export function LocalizedAppointmentCardDate({
  iso,
  mode,
}: {
  iso: string;
  mode: CalendarMode;
}) {
  return (
    <DualDateDisplay
      iso={iso}
      mode={mode}
      primaryClassName="text-sm font-bold"
      secondaryClassName="text-xs"
      variant="short"
    />
  );
}

export function DualCalendarDatePicker({
  toolbar = false,
  periodLabel,
  disabled = false,
  label = "Appointment date",
  max,
  min,
  mode,
  onChange,
  onModeChange,
  value,
}: {
  toolbar?: boolean;
  periodLabel?: string;
  disabled?: boolean;
  label?: string;
  max?: string;
  min?: string;
  mode: CalendarMode;
  onChange: (adDateKey: string) => void;
  onModeChange: (mode: CalendarMode) => void;
  value: string;
}) {
  const todayAdDateKey = dateKeyInTimeZone(NEPAL_TIME_ZONE);
  const [anchorAdDateKey, setAnchorAdDateKey] = useState(value);
  const [focusedAdDateKey, setFocusedAdDateKey] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 72, maxHeight: 520 });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();
  const popoverId = useId();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setAnchorAdDateKey(value);
    setFocusedAdDateKey(value);
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node) && !dialogRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("pointerdown", handlePointerDown);
    }

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusedAdDateKey}"]`)
        ?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [focusedAdDateKey, isOpen]);

  useEffect(() => {
    if (!isOpen || !toolbar) return;
    function positionPopover() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const top = window.innerWidth < 768 ? 72 : Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 520));
      setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top, maxHeight: window.innerHeight - top - 16 });
    }
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [isOpen, toolbar]);

  function renderPopover(node: ReactNode) {
    return toolbar ? createPortal(node, document.body) : node;
  }

  const grid = useMemo(
    () => buildCalendarGrid(anchorAdDateKey, mode),
    [anchorAdDateKey, mode],
  );
  const dual = getDualCalendarDay(value);
  const triggerPrimary = mode === "BS" ? dual.bsDate : dual.adDate;
  const triggerSecondary = mode === "BS" ? dual.adDate : dual.bsDate;

  function commitDate(adDateKey: string) {
    if (!isDateKeyWithinBounds(adDateKey, min, max)) {
      return;
    }

    onChange(adDateKey);
    setAnchorAdDateKey(adDateKey);
    setFocusedAdDateKey(adDateKey);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function closePopover() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function openPopover() {
    setAnchorAdDateKey(value);
    setFocusedAdDateKey(value);
    setIsOpen(true);
  }

  function moveCalendarPage(months: number) {
    const nextAnchor = shiftCalendarPage(anchorAdDateKey, mode, months);
    setAnchorAdDateKey(nextAnchor);
    setFocusedAdDateKey(nextAnchor);
  }

  function handleCalendarKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    adDateKey: string,
  ) {
    if (
      ![
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
      ].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();
    const nextDateKey = moveCalendarFocus(
      adDateKey,
      event.key as Parameters<typeof moveCalendarFocus>[1],
    );

    if (!isDateKeyWithinBounds(nextDateKey, min, max)) {
      return;
    }

    setFocusedAdDateKey(nextDateKey);
    setAnchorAdDateKey(nextDateKey);
  }

  return (
    <div className={toolbar ? "min-w-0" : "space-y-2"}>
      <div className={toolbar ? "sr-only" : "flex items-center justify-between gap-3"}>
        <div className="text-sm font-medium text-[var(--ink)]" id={labelId}>
          {label}
        </div>
        {!toolbar ? <CalendarModeToggle className="h-9" mode={mode} onChange={onModeChange} /> : null}
      </div>

      <div className="relative" ref={popoverRef}>
        <button
          aria-controls={popoverId}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-labelledby={`${labelId} ${popoverId}-value`}
          className="flex min-h-12 w-full items-center justify-between rounded-md border border-[var(--border)] bg-white px-3 py-2 text-left outline-none transition hover:border-[var(--accent)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
          disabled={disabled}
          onClick={() => (isOpen ? closePopover() : openPopover())}
          ref={triggerRef}
          type="button"
        >
          <div className="min-w-0">
            <div
              className={clsx("truncate font-semibold text-[var(--ink)]", toolbar ? "text-base md:text-xl" : "text-sm")}
              id={`${popoverId}-value`}
            >
              {periodLabel ?? triggerPrimary}
            </div>
            <div className="truncate text-xs text-[var(--text-muted)]">
              {mode === "AD" ? `BS ${triggerSecondary}` : `AD ${triggerSecondary}`}
            </div>
          </div>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--ink)]">
            <CalendarDays aria-hidden="true" size={17} />
          </div>
        </button>

        {isOpen ? renderPopover(
          <div
            aria-labelledby={`${popoverId}-heading`}
            ref={dialogRef}
            style={toolbar ? position : undefined}
            className={clsx(toolbar ? "fixed z-[100] overflow-y-auto" : "absolute left-0 top-[calc(100%+0.5rem)] z-30", "w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]")}
            id={popoverId}
            onKeyDown={(event) => {
              if (toolbar && event.key === "Tab") {
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")).filter((control) => control.tabIndex >= 0);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closePopover();
              }
            }}
            role="dialog"
          >
            <div className="border-b border-[var(--border)] p-3">
              {toolbar ? <div className="mb-3 flex items-center justify-between"><CalendarModeToggle mode={mode} onChange={onModeChange} /><button type="button" className="min-h-11 px-3 text-sm" onClick={closePopover}>Close</button></div> : null}
              {!toolbar ? <>
              <label className="block text-xs font-semibold text-[var(--text-muted)]">
                Gregorian date (AD)
                <input
                  className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
                  max={max}
                  min={min}
                  onChange={(event) => {
                    if (event.target.value) {
                      commitDate(event.target.value);
                    }
                  }}
                  type="date"
                  value={value}
                />
              </label>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Nepali date (BS): <span className="font-semibold text-[var(--ink)]">{dual.bsDate}</span>
              </p>
              </> : null}
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <div>
                <div className="text-sm font-bold text-[var(--ink)]" id={`${popoverId}-heading`}>
                  {grid.primaryMonthLabel}
                </div>
                <div className="text-xs text-[var(--text-muted)]">{grid.secondaryMonthLabel}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  aria-label="Previous month"
                  className="flex size-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  onClick={() => moveCalendarPage(-1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={16} />
                </button>
                <button
                  aria-label="Next month"
                  className="flex size-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  onClick={() => moveCalendarPage(1)}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="grid grid-cols-7 px-2 pt-2 text-center text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]"
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div className="py-1" key={day}>
                  {day}
                </div>
              ))}
            </div>

            <div
              aria-label={`${grid.primaryMonthLabel} calendar`}
              className="grid grid-cols-7 gap-0.5 px-2 pb-2"
              role="grid"
            >
              {grid.cells.map((cell) => {
                const isSelected = cell.adDateKey === value;
                const isToday = cell.adDateKey === todayAdDateKey;
                const isFocused = cell.adDateKey === focusedAdDateKey;
                const isDisabled = !isDateKeyWithinBounds(cell.adDateKey, min, max);
                const primaryDay = mode === "BS" ? cell.dual.bsDay : cell.dual.adDay;
                const secondaryDay = mode === "BS" ? cell.dual.adDay : cell.dual.bsDay;

                return (
                  <button
                    aria-label={`${cell.dual.adDate}; Nepali date ${cell.dual.bsDate}${isToday ? "; today" : ""}`}
                    aria-selected={isSelected}
                    className={clsx(
                      "flex aspect-square min-h-9 flex-col items-center justify-center rounded-md text-center outline-none transition",
                      cell.inCurrentMonth ? "text-[var(--ink)]" : "text-[var(--text-muted)] opacity-55",
                      isSelected && "bg-[var(--accent)] text-white",
                      !isSelected && !isDisabled && "hover:bg-[var(--surface-muted)]",
                      isFocused && "ring-2 ring-[var(--accent)] ring-offset-1",
                      isDisabled && "cursor-not-allowed opacity-30",
                    )}
                    data-calendar-date={cell.adDateKey}
                    disabled={isDisabled}
                    key={cell.adDateKey}
                    onClick={() => commitDate(cell.adDateKey)}
                    onFocus={() => setFocusedAdDateKey(cell.adDateKey)}
                    onKeyDown={(event) => handleCalendarKeyDown(event, cell.adDateKey)}
                    role="gridcell"
                    tabIndex={isFocused ? 0 : -1}
                    type="button"
                  >
                    <span className="text-xs font-bold leading-none">{primaryDay}</span>
                    <span
                      className={clsx(
                        "mt-0.5 text-[9px] leading-none",
                        isSelected ? "text-white/75" : "text-[var(--text-muted)]",
                      )}
                    >
                      {secondaryDay}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2">
              {toolbar ? (
                <DualDateDisplay
                  adDateKey={todayAdDateKey}
                  mode={mode}
                  primaryClassName="text-xs"
                  secondaryClassName="text-[10px]"
                />
              ) : <span className="text-[10px] text-[var(--text-muted)]">Stored as AD/ISO</span>}
              <Button
                disabled={!isDateKeyWithinBounds(todayAdDateKey, min, max)}
                onClick={() => commitDate(todayAdDateKey)}
                variant="secondary"
              >
                Today
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

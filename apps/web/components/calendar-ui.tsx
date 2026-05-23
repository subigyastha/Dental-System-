"use client";

import { clsx } from "clsx";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import {
  buildCalendarGrid,
  CALENDAR_MODES,
  type CalendarMode,
  dateKeyInTimeZone,
  getDualCalendarDay,
  NEPAL_TIME_ZONE,
  normalizeCalendarInputToAdDateKey,
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
      className={clsx(
        "flex h-10 overflow-hidden rounded-md border border-[var(--border)] bg-white p-1",
        className,
      )}
    >
      {CALENDAR_MODES.map((calendarMode) => (
        <button
          className={clsx(
            "rounded px-3 text-sm font-bold transition",
            mode === calendarMode
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)] hover:text-[var(--ink)]",
          )}
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
  mode,
  onChange,
  onModeChange,
  value,
}: {
  mode: CalendarMode;
  onChange: (adDateKey: string) => void;
  onModeChange: (mode: CalendarMode) => void;
  value: string;
}) {
  const todayAdDateKey = dateKeyInTimeZone(NEPAL_TIME_ZONE);
  const [anchorAdDateKey, setAnchorAdDateKey] = useState(value);
  const [bsInputValue, setBsInputValue] = useState(getDualCalendarDay(value).bsDateKey);
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAnchorAdDateKey(value);
    setBsInputValue(getDualCalendarDay(value).bsDateKey);
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const grid = useMemo(
    () => buildCalendarGrid(anchorAdDateKey, mode),
    [anchorAdDateKey, mode],
  );
  const dual = getDualCalendarDay(value);
  const triggerPrimary = mode === "BS" ? dual.bsDate : dual.adDate;
  const triggerSecondary = mode === "BS" ? dual.adDate : dual.bsDate;

  function commitDate(adDateKey: string) {
    onChange(adDateKey);
    setAnchorAdDateKey(adDateKey);
    setBsInputValue(getDualCalendarDay(adDateKey).bsDateKey);
    setIsOpen(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--ink)]">Appointment date</div>
        <CalendarModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <div className="relative" ref={popoverRef}>
        <button
          className="flex w-full items-center justify-between rounded-md border border-[var(--border)] bg-white px-4 py-3 text-left transition hover:border-[var(--accent)]"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {mode} date
            </div>
            <div className="mt-1 truncate text-sm font-bold text-[var(--ink)]">
              {triggerPrimary}
            </div>
            <div className="truncate text-xs text-[var(--text-muted)]">
              {triggerSecondary}
            </div>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--ink)]">
            <CalendarDays size={18} />
          </div>
        </button>

        {isOpen ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.14)]">
            <div className="grid gap-3 border-b border-[var(--border)] p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              {mode === "BS" ? (
                <label className="block text-sm">
                  <span className="font-semibold text-[var(--ink)]">BS date</span>
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                    onBlur={() => setBsInputValue(getDualCalendarDay(value).bsDateKey)}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setBsInputValue(nextValue);
                      const adDateKey = normalizeCalendarInputToAdDateKey(nextValue, "BS");
                      if (adDateKey) {
                        onChange(adDateKey);
                        setAnchorAdDateKey(adDateKey);
                      }
                    }}
                    placeholder="2083-01-12"
                    value={bsInputValue}
                  />
                </label>
              ) : (
                <label className="block text-sm">
                  <span className="font-semibold text-[var(--ink)]">AD date</span>
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)]"
                    onChange={(event) => {
                      onChange(event.target.value);
                      setAnchorAdDateKey(event.target.value);
                    }}
                    type="date"
                    value={value}
                  />
                </label>
              )}
              <div className="flex items-end">
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => commitDate(todayAdDateKey)}
                  variant="secondary"
                >
                  Today
                </Button>
              </div>
            </div>

            <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <DualDateDisplay adDateKey={value} mode={mode} />
            </div>

            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <div>
                <div className="text-sm font-bold text-[var(--ink)]">{grid.primaryMonthLabel}</div>
                <div className="text-xs text-[var(--text-muted)]">{grid.secondaryMonthLabel}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="flex size-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-white"
                  onClick={() => setAnchorAdDateKey(shiftCalendarPage(anchorAdDateKey, mode, -1))}
                  type="button"
                >
                  <ChevronRight className="rotate-180" size={16} />
                </button>
                <button
                  className="flex size-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-white"
                  onClick={() => setAnchorAdDateKey(shiftCalendarPage(anchorAdDateKey, mode, 1))}
                  type="button"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-subtle)] text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div className="px-2 py-2" key={day}>
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {grid.cells.map((cell) => {
                const isSelected = cell.adDateKey === value;
                const isToday = cell.adDateKey === todayAdDateKey;
                const primaryDay = mode === "BS" ? cell.dual.bsDay : cell.dual.adDay;
                const secondaryDay = mode === "BS" ? cell.dual.adDay : cell.dual.bsDay;

                return (
                  <button
                    className={clsx(
                      "min-h-20 border-b border-r border-[var(--border)] px-2 py-2 text-left transition",
                      cell.inCurrentMonth ? "bg-white" : "bg-[var(--surface-subtle)] text-[var(--text-muted)]",
                      isSelected && "ring-2 ring-inset ring-[var(--accent)]",
                      !isSelected && "hover:bg-[var(--surface-muted)]",
                    )}
                    key={cell.adDateKey}
                    onClick={() => commitDate(cell.adDateKey)}
                    type="button"
                  >
                    <div className="text-base font-black leading-none text-[var(--ink)]">
                      {primaryDay}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-muted)]">
                        {secondaryDay}
                      </span>
                      {isToday ? (
                        <span className="rounded-full bg-[var(--secondary-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--secondary-text)]">
                          Today
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

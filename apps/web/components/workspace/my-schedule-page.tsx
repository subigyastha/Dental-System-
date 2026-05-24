"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";

import { Button } from "@/components/ui";
import {
  type AvailabilityDraft,
  type BlockedTimeDraft,
  type RecurringBlockDraft,
  useWorkspaceApp,
} from "@/components/workspace/app-state";
import {
  EmptyState,
  Modal,
  PageHeader,
  inputClassName,
} from "@/components/workspace/elements";
import { ReservationsPage } from "@/components/workspace/reservations-page";
import { buildBlockedTimeIso } from "@/components/workspace/workspace-utils";
import { dateKeyInTimeZone, getMinutesInNepalFromIso, NEPAL_TIME_ZONE } from "@/lib/calendar";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MySchedulePage() {
  const { data, sessionUser, updateProviderSchedule } = useWorkspaceApp();
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const provider = data.providers.find((item) => item.id === sessionUser?.providerId);

  return (
    <div className="space-y-5">
      <PageHeader
        action={
          provider ? (
            <Button onClick={() => setIsEditingSchedule(true)} variant="secondary">
              <CalendarRange size={16} />
              Edit schedule
            </Button>
          ) : undefined
        }
        subtitle="Your booked work and your own availability live together here."
        title="My schedule"
      />

      <ReservationsPage
        visibleProviderScope={sessionUser?.providerId}
      />

      {isEditingSchedule && provider ? (
        <ProviderScheduleModal
          onClose={() => setIsEditingSchedule(false)}
          onSubmit={async (availability, recurringBlocks, blockedTimes) => {
            await updateProviderSchedule(provider.id, availability, recurringBlocks, blockedTimes);
            setIsEditingSchedule(false);
          }}
          provider={provider}
        />
      ) : null}
    </div>
  );
}

function ProviderScheduleModal({
  onClose,
  onSubmit,
  provider,
}: {
  onClose: () => void;
  onSubmit: (
    availability: AvailabilityDraft[],
    recurringBlocks: RecurringBlockDraft[],
    blockedTimes: BlockedTimeDraft[],
  ) => Promise<void>;
  provider: NonNullable<ReturnType<typeof useWorkspaceApp>["data"]["providers"][number]>;
}) {
  const { calendarMode } = useWorkspaceApp();
  const [availability, setAvailability] = useState<AvailabilityDraft[]>(provider.availability);
  const [recurringBlocks, setRecurringBlocks] = useState<RecurringBlockDraft[]>(
    provider.recurringBlocks,
  );
  const [blockedTimes, setBlockedTimes] = useState<BlockedTimeDraft[]>(provider.blockedTimes);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSubmit(availability, recurringBlocks, blockedTimes);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="Set your weekly working windows, repeating breaks, and one-off time blocks."
      title={`${provider.name} schedule`}
    >
      <div className="space-y-6">
        <Section title="Weekly availability">
          {availability.map((entry, index) => (
            <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[120px_1fr_1fr_100px_80px]" key={entry.id ?? `${entry.dayOfWeek}-${index}`}>
              <select
                className={inputClassName}
                onChange={(event) =>
                  setAvailability((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, dayOfWeek: Number(event.target.value) } : item,
                    ),
                  )
                }
                value={entry.dayOfWeek}
              >
                {dayLabels.map((label, dayIndex) => (
                  <option key={label} value={dayIndex}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className={inputClassName}
                onChange={(event) =>
                  setAvailability((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, startsAtLocal: event.target.value } : item,
                    ),
                  )
                }
                type="time"
                value={entry.startsAtLocal}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setAvailability((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, endsAtLocal: event.target.value } : item,
                    ),
                  )
                }
                type="time"
                value={entry.endsAtLocal}
              />
              <input
                className={inputClassName}
                disabled
                type="number"
                value={entry.slotDurationMinutes}
              />
              <Button
                onClick={() =>
                  setAvailability((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              setAvailability((current) => [
                ...current,
                {
                  dayOfWeek: 1,
                  startsAtLocal: "09:00",
                  endsAtLocal: "17:00",
                  slotDurationMinutes: 60,
                  bufferMinutes: 10,
                  isActive: true,
                },
              ])
            }
            variant="secondary"
          >
            Add weekly window
          </Button>
        </Section>

        <Section title="Recurring blocks">
          {recurringBlocks.length ? (
            recurringBlocks.map((entry, index) => (
              <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[120px_1fr_1fr_minmax(0,1fr)_80px]" key={entry.id ?? `${entry.dayOfWeek}-${index}`}>
                <select
                  className={inputClassName}
                  onChange={(event) =>
                    setRecurringBlocks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dayOfWeek: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  value={entry.dayOfWeek}
                >
                  {dayLabels.map((label, dayIndex) => (
                    <option key={label} value={dayIndex}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setRecurringBlocks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, startsAtLocal: event.target.value } : item,
                      ),
                    )
                  }
                  type="time"
                  value={entry.startsAtLocal}
                />
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setRecurringBlocks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, endsAtLocal: event.target.value } : item,
                      ),
                    )
                  }
                  type="time"
                  value={entry.endsAtLocal}
                />
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setRecurringBlocks((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, reason: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="Lunch, admin, rounds"
                  value={entry.reason}
                />
                <Button
                  onClick={() =>
                    setRecurringBlocks((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  variant="ghost"
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <EmptyState body="No recurring breaks configured." title="No recurring blocks" />
          )}
          <Button
            onClick={() =>
              setRecurringBlocks((current) => [
                ...current,
                {
                  dayOfWeek: 1,
                  startsAtLocal: "13:00",
                  endsAtLocal: "14:00",
                  reason: "Break",
                  isActive: true,
                },
              ])
            }
            variant="secondary"
          >
            Add recurring block
          </Button>
        </Section>

        <Section title={`One-off blocks (${calendarMode})`}>
          {blockedTimes.map((entry, index) => (
            <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[1fr_140px_140px_minmax(0,1fr)_80px]" key={entry.id ?? `${entry.startsAtIso}-${index}`}>
              <input
                className={inputClassName}
                onChange={(event) => {
                  const startTime = minutesToTimeInput(getMinutesInNepalFromIso(entry.startsAtIso));
                  const endTime = minutesToTimeInput(getMinutesInNepalFromIso(entry.endsAtIso));
                  setBlockedTimes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            startsAtIso: buildBlockedTimeIso(event.target.value, startTime),
                            endsAtIso: buildBlockedTimeIso(event.target.value, endTime),
                          }
                        : item,
                    ),
                  );
                }}
                type="date"
                value={dateKeyInTimeZone(NEPAL_TIME_ZONE, new Date(entry.startsAtIso))}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setBlockedTimes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            startsAtIso: buildBlockedTimeIso(
                              dateKeyInTimeZone(NEPAL_TIME_ZONE, new Date(item.startsAtIso)),
                              event.target.value,
                            ),
                          }
                        : item,
                    ),
                  )
                }
                type="time"
                value={minutesToTimeInput(getMinutesInNepalFromIso(entry.startsAtIso))}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setBlockedTimes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            endsAtIso: buildBlockedTimeIso(
                              dateKeyInTimeZone(NEPAL_TIME_ZONE, new Date(item.startsAtIso)),
                              event.target.value,
                            ),
                          }
                        : item,
                    ),
                  )
                }
                type="time"
                value={minutesToTimeInput(getMinutesInNepalFromIso(entry.endsAtIso))}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setBlockedTimes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, reason: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Leave, procedure, meeting"
                value={entry.reason}
              />
              <Button
                onClick={() =>
                  setBlockedTimes((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              setBlockedTimes((current) => [
                ...current,
                {
                  startsAtIso: buildBlockedTimeIso(dateKeyInTimeZone(NEPAL_TIME_ZONE), "12:00"),
                  endsAtIso: buildBlockedTimeIso(dateKeyInTimeZone(NEPAL_TIME_ZONE), "13:00"),
                  reason: "Break",
                },
              ])
            }
            variant="secondary"
          >
            Add date block
          </Button>
        </Section>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()}>{isSaving ? "Saving..." : "Save schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-[var(--foreground)]">{title}</div>
      {children}
    </div>
  );
}

function minutesToTimeInput(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

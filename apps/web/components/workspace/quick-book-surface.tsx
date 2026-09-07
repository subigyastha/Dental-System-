"use client";

import { CheckCircle2, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { Drawer } from "@/components/workspace/elements";
import { GuidedQuickBookFlow as AppointmentBookingModal } from "@/components/workspace/guided-quick-book-flow";
import { useQuickBook } from "@/components/workspace/quick-book-provider";

export function QuickBookSurface() {
  const { workspaceBootstrap } = useWorkspaceApp();
  const quickBook = useQuickBook();
  const [locationBackConfirmationOpen, setLocationBackConfirmationOpen] =
    useState(false);
  const locationBackTriggerRef = useRef<HTMLElement | null>(null);

  if (!quickBook.isOpen) {
    return null;
  }

  const locations = workspaceBootstrap.locations.filter(
    (location) => location.canCreateAppointment,
  );
  const requiresLocationStep =
    locations.length > 1 && quickBook.currentStep === null;
  const refs = quickBook.prefill.refs ?? {};

  if (requiresLocationStep) {
    return (
      <>
        <Drawer
          context="Choose where this appointment will take place. Providers and services are scoped to the selected clinic."
          onClose={quickBook.requestClose}
          stepLabel="Step 1 of 2 · Clinic location"
          title="Book appointment"
        >
          <div className="space-y-5">
            <div className="space-y-2" role="radiogroup" aria-label="Clinic location">
              {locations.map((location) => {
                const selected = quickBook.selectedLocationId === location.id;
                return (
                  <button
                    aria-checked={selected}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                    }`}
                    key={location.id}
                    onClick={() => quickBook.setSelectedLocationId(location.id)}
                    role="radio"
                    type="button"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--accent-strong)]">
                      <MapPin aria-hidden="true" size={17} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--foreground)]">
                        {location.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                        {location.timezone}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {quickBook.bootstrapError ? (
              <BookingLoadError
                message={quickBook.bootstrapError}
                onRetry={quickBook.retryBootstrap}
              />
            ) : null}

            <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-white px-5 py-4">
              <Button onClick={quickBook.requestClose} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={
                  !quickBook.selectedLocationId ||
                  quickBook.isBootstrapLoading ||
                  Boolean(quickBook.bootstrapError)
                }
                loading={quickBook.isBootstrapLoading}
                loadingLabel="Loading booking details"
                onClick={() => quickBook.setStep("client", { replace: true })}
              >
                Continue
              </Button>
            </div>
          </div>
        </Drawer>
        <DiscardBookingDialog />
      </>
    );
  }

  if (quickBook.isBootstrapLoading || !quickBook.bootstrap) {
    return (
      <>
        <Drawer
          context="Loading the providers and services available at this clinic."
          onClose={quickBook.requestClose}
          stepLabel={locations.length > 1 ? "Step 2 of 2 · Appointment details" : "Appointment details"}
          title="Book appointment"
        >
          {quickBook.bootstrapError ? (
            <BookingLoadError
              message={quickBook.bootstrapError}
              onRetry={quickBook.retryBootstrap}
            />
          ) : (
            <div aria-live="polite" className="flex min-h-48 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto size-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
                <p className="mt-3 text-sm text-[var(--text-muted)]">
                  Loading booking details…
                </p>
              </div>
            </div>
          )}
        </Drawer>
        <DiscardBookingDialog />
      </>
    );
  }

  return (
    <>
      <AppointmentBookingModal
        bookingBootstrap={quickBook.bootstrap}
        defaultCustomerId={refs.customerId}
        defaultProviderId={refs.providerId}
        initialDate={refs.date}
        initialSlotIso={refs.slotIso}
        locationId={quickBook.selectedLocationId ?? undefined}
        onBack={
          locations.length > 1
            ? () => {
                if (quickBook.isDirty) {
                  locationBackTriggerRef.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setLocationBackConfirmationOpen(true);
                  return;
                }
                quickBook.setStep(null, { replace: true });
              }
            : undefined
        }
        onClose={quickBook.requestClose}
        onDirtyChange={quickBook.setDirty}
        stepLabel={
          locations.length > 1
            ? "Step 2 of 2 · Appointment details"
            : "Appointment details"
        }
      />
      {quickBook.isMinimized ? <BackgroundBookingStatus /> : null}
      <DiscardBookingDialog
        locationBackOpen={locationBackConfirmationOpen}
        onCancelLocationBack={() => {
          setLocationBackConfirmationOpen(false);
          window.setTimeout(() => locationBackTriggerRef.current?.focus(), 0);
        }}
        onConfirmLocationBack={() => {
          setLocationBackConfirmationOpen(false);
          quickBook.setDirty(false);
          quickBook.setStep(null, { replace: true });
        }}
      />
    </>
  );
}

function BackgroundBookingStatus() {
  const quickBook = useQuickBook();
  const completed = quickBook.currentStep === "success";
  const needsAttention = !quickBook.isBusy && !completed;

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-20 right-4 z-[75] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-white p-4 shadow-xl md:bottom-5"
    >
      <button
        className="flex w-full items-start gap-3 text-left"
        onClick={quickBook.reopen}
        type="button"
      >
        <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
          completed ? "bg-emerald-100 text-emerald-700" : needsAttention ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"
        }`}>
          {completed ? (
            <CheckCircle2 aria-hidden="true" size={18} />
          ) : (
            <LoaderCircle aria-hidden="true" className={quickBook.isBusy ? "animate-spin" : ""} size={18} />
          )}
        </span>
        <span className="min-w-0">
          <strong className="block text-sm text-[var(--foreground)]">
            {completed ? "Appointment booked" : needsAttention ? "Booking needs attention" : "Booking appointment"}
          </strong>
          <span className="mt-1 block text-xs text-[var(--text-muted)]">
            {completed
              ? "The clinic server confirmed the appointment."
              : needsAttention
                ? "Open the booking to review the result and retry safely."
                : "You can keep using ClinicFlow while the server confirms the slot."}
          </span>
        </span>
      </button>
      {completed ? (
        <div className="mt-3 flex justify-end">
          <Button onClick={quickBook.closeQuickBook} variant="ghost">Done</Button>
        </div>
      ) : null}
    </aside>
  );
}

function BookingLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      aria-live="assertive"
      className="rounded-lg border border-rose-200 bg-rose-50 p-4"
      role="alert"
    >
      <p className="text-sm text-[var(--danger)]">{message}</p>
      <Button className="mt-4" onClick={onRetry} variant="secondary">
        <RefreshCw aria-hidden="true" size={15} />
        Try again
      </Button>
    </div>
  );
}

function DiscardBookingDialog({
  locationBackOpen = false,
  onCancelLocationBack,
  onConfirmLocationBack,
}: {
  locationBackOpen?: boolean;
  onCancelLocationBack?: () => void;
  onConfirmLocationBack?: () => void;
} = {}) {
  const quickBook = useQuickBook();
  const dialogRef = useRef<HTMLElement | null>(null);
  const isOpen = locationBackOpen || quickBook.isCloseConfirmationOpen;
  const cancel = locationBackOpen
    ? onCancelLocationBack ?? (() => undefined)
    : quickBook.cancelClose;
  const confirm = locationBackOpen
    ? onConfirmLocationBack ?? (() => undefined)
    : quickBook.confirmClose;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const drawer = document.querySelector<HTMLElement>('[data-testid="workspace-drawer"]');
    const previousAriaHidden = drawer?.getAttribute("aria-hidden");
    const wasInert = drawer?.hasAttribute("inert") ?? false;
    drawer?.setAttribute("aria-hidden", "true");
    drawer?.setAttribute("inert", "");

    return () => {
      if (previousAriaHidden === null) {
        drawer?.removeAttribute("aria-hidden");
      } else if (previousAriaHidden !== undefined) {
        drawer?.setAttribute("aria-hidden", previousAriaHidden);
      }
      if (!wasInert) {
        drawer?.removeAttribute("inert");
      }
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4">
      <section
        aria-describedby="discard-booking-description"
        aria-labelledby="discard-booking-title"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--popover-shadow)]"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="alertdialog"
      >
        <h2 className="text-base font-semibold text-[var(--foreground)]" id="discard-booking-title">
          {locationBackOpen ? "Return to location selection?" : "Discard this booking?"}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]" id="discard-booking-description">
          {locationBackOpen
            ? "Your appointment details will be cleared before you choose another location."
            : "Your unsaved appointment details will be lost."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            autoFocus
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
            onClick={cancel}
            type="button"
          >
            Keep editing
          </button>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--danger)] px-3 text-sm font-medium text-white hover:opacity-90"
            onClick={confirm}
            type="button"
          >
            {locationBackOpen ? "Clear and go back" : "Discard"}
          </button>
        </div>
      </section>
    </div>
  );
}

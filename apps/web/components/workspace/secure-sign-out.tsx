"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useWorkspaceApp } from "@/components/workspace/app-state";
import { useQuickBook } from "@/components/workspace/quick-book-provider";

type SecureSignOutContextValue = {
  error: string | null;
  isBlocked: boolean;
  isSigningOut: boolean;
  requestSignOut: () => void;
};

const SecureSignOutContext = createContext<SecureSignOutContextValue | null>(null);

export function SecureSignOutProvider({ children }: { children: ReactNode }) {
  const {
    clearLogoutError,
    isLoggingOut,
    logout,
    logoutError,
  } = useWorkspaceApp();
  const quickBook = useQuickBook();
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const performSignOut = useCallback(() => {
    setConfirmationOpen(false);
    void logout();
  }, [logout]);

  const requestSignOut = useCallback(() => {
    clearLogoutError();
    if (isLoggingOut || quickBook.isBusy) {
      return;
    }
    if (quickBook.isDirty) {
      setConfirmationOpen(true);
      return;
    }
    performSignOut();
  }, [clearLogoutError, isLoggingOut, performSignOut, quickBook.isBusy, quickBook.isDirty]);

  const value = useMemo<SecureSignOutContextValue>(
    () => ({
      error: logoutError,
      isBlocked: quickBook.isBusy,
      isSigningOut: isLoggingOut,
      requestSignOut,
    }),
    [isLoggingOut, logoutError, quickBook.isBusy, requestSignOut],
  );

  return (
    <SecureSignOutContext.Provider value={value}>
      {children}
      {logoutError ? (
        <div
          aria-live="assertive"
          className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-xl rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[var(--danger)] shadow-[var(--popover-shadow)]"
          role="alert"
        >
          {logoutError}
        </div>
      ) : null}
      {confirmationOpen ? (
        <SignOutConfirmationDialog
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={performSignOut}
        />
      ) : null}
    </SecureSignOutContext.Provider>
  );
}

export function useSecureSignOut() {
  const context = useContext(SecureSignOutContext);
  if (!context) {
    throw new Error("useSecureSignOut must be used inside SecureSignOutProvider");
  }
  return context;
}

export function signOutButtonLabel({
  isBlocked,
  isSigningOut,
}: {
  isBlocked: boolean;
  isSigningOut: boolean;
}) {
  if (isSigningOut) return "Signing out…";
  if (isBlocked) return "Finishing booking…";
  return "Sign out";
}

function SignOutConfirmationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const shell = document.querySelector<HTMLElement>("[data-workspace-shell]");
    const previousAriaHidden = shell?.getAttribute("aria-hidden");
    const wasInert = shell?.hasAttribute("inert") ?? false;
    shell?.setAttribute("aria-hidden", "true");
    shell?.setAttribute("inert", "");
    return () => {
      if (previousAriaHidden === null) shell?.removeAttribute("aria-hidden");
      else if (previousAriaHidden !== undefined) shell?.setAttribute("aria-hidden", previousAriaHidden);
      if (!wasInert) shell?.removeAttribute("inert");
      previouslyFocused?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
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
    } else if (event.shiftKey && document.activeElement === first) {
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
        aria-describedby="sign-out-description"
        aria-labelledby="sign-out-title"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--popover-shadow)]"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="alertdialog"
      >
        <h2 className="text-base font-semibold text-[var(--foreground)]" id="sign-out-title">
          Sign out and discard this booking draft?
        </h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]" id="sign-out-description">
          Your unsaved appointment details will be cleared after the server confirms sign out.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            autoFocus
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
            onClick={onCancel}
            type="button"
          >
            Keep editing
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--danger)] px-4 text-sm font-medium text-white hover:opacity-90"
            onClick={onConfirm}
            type="button"
          >
            Discard and sign out
          </button>
        </div>
      </section>
    </div>
  );
}

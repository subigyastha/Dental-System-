"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useWorkspaceApp } from "@/components/workspace/app-state";
import type { BookingBootstrap } from "@/lib/booking-bootstrap";
import {
  createGuidedBookingDraft,
  type GuidedBookingDraft,
} from "@/lib/guided-booking";
import {
  advanceQuickBookHistoryMarker,
  createClosedQuickBookHref,
  createQuickBookHref,
  normalizeQuickBookStepRef,
  planQuickBookClose,
  readQuickBookHistoryMarker,
  readQuickBookUrl,
  resolveQuickBookLocation,
  sanitizeQuickBookPrefill,
  shouldRestoreBusyQuickBookEntry,
  withQuickBookHistoryMarker,
  withoutQuickBookHistoryMarker,
  type QuickBookHistoryMarker,
  type QuickBookPrefill,
  type QuickBookStepRef,
} from "@/lib/quick-book";

export type QuickBookDraft = GuidedBookingDraft;

export type QuickBookController = {
  isOpen: boolean;
  canOpen: boolean;
  currentStep: QuickBookStepRef | null;
  prefill: QuickBookPrefill;
  draft: QuickBookDraft;
  isDirty: boolean;
  isBusy: boolean;
  isMinimized: boolean;
  isCloseConfirmationOpen: boolean;
  selectedLocationId: string | null;
  bootstrap: BookingBootstrap | null;
  isBootstrapLoading: boolean;
  bootstrapError: string | null;
  openQuickBook: (prefill?: QuickBookPrefill) => void;
  requestClose: () => boolean;
  closeQuickBook: () => void;
  confirmClose: () => void;
  cancelClose: () => void;
  back: () => void;
  setStep: (
    step: QuickBookStepRef | null,
    options?: { replace?: boolean },
  ) => boolean;
  setDraft: (draft: SetStateAction<QuickBookDraft>) => void;
  setDirty: (isDirty: boolean) => void;
  setBusy: (isBusy: boolean) => void;
  minimize: () => void;
  reopen: () => void;
  setSelectedLocationId: (locationId: string) => void;
  retryBootstrap: () => void;
};

const QuickBookContext = createContext<QuickBookController | null>(null);

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `quick-book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuickBookProvider({ children }: { children: ReactNode }) {
  const { loadBookingBootstrap, workspaceBootstrap } = useWorkspaceApp();
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<QuickBookStepRef | null>(null);
  const [prefill, setPrefill] = useState<QuickBookPrefill>({});
  const [draft, setDraft] = useState<QuickBookDraft>(() =>
    createGuidedBookingDraft(),
  );
  const [isDirty, setIsDirtyState] = useState(false);
  const [isBusy, setIsBusyState] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isCloseConfirmationOpen, setIsCloseConfirmationOpen] =
    useState(false);
  const [selectedLocationId, setSelectedLocationIdState] = useState<
    string | null
  >(null);
  const [bootstrap, setBootstrap] = useState<BookingBootstrap | null>(null);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const isOpenRef = useRef(false);
  const isDirtyRef = useRef(false);
  const isBusyRef = useRef(false);
  const lastOpenHrefRef = useRef<string | null>(null);
  const lastMarkerRef = useRef<QuickBookHistoryMarker | null>(null);
  const pendingDirectCloseRef = useRef(false);
  const closeTriggerRef = useRef<HTMLElement | null>(null);

  const bookingLocations = useMemo(
    () =>
      workspaceBootstrap.context.capabilities.canCreateAppointment
        ? workspaceBootstrap.locations.filter(
            (location) => location.canCreateAppointment,
          )
        : [],
    [workspaceBootstrap],
  );
  const canOpen = bookingLocations.length > 0;

  const resetClosedState = useCallback(() => {
    isOpenRef.current = false;
    isDirtyRef.current = false;
    isBusyRef.current = false;
    lastOpenHrefRef.current = null;
    lastMarkerRef.current = null;
    closeTriggerRef.current = null;
    setIsOpen(false);
    setCurrentStep(null);
    setPrefill({});
    setDraft(createGuidedBookingDraft());
    setIsDirtyState(false);
    setIsBusyState(false);
    setIsMinimized(false);
    setIsCloseConfirmationOpen(false);
    setSelectedLocationIdState(null);
    setBootstrap(null);
    setIsBootstrapLoading(false);
    setBootstrapError(null);
  }, []);

  const replaceWithClosedUrl = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.history.replaceState(
      withoutQuickBookHistoryMarker(window.history.state),
      "",
      createClosedQuickBookHref(window.location.href),
    );
    resetClosedState();
  }, [resetClosedState]);

  const syncFromHistory = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const urlState = readQuickBookUrl(window.location.href);
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (
      shouldRestoreBusyQuickBookEntry({
        currentHref,
        isBusy: isBusyRef.current,
        isOpen: isOpenRef.current,
        lastOpenHref: lastOpenHrefRef.current,
      })
    ) {
      window.history.pushState(
        withQuickBookHistoryMarker(
          window.history.state,
          lastMarkerRef.current ?? {
            version: 1,
            sessionId: createSessionId(),
            depth: 0,
            origin: "direct",
          },
        ),
        "",
        lastOpenHrefRef.current!,
      );
      return;
    }
    if (pendingDirectCloseRef.current) {
      pendingDirectCloseRef.current = false;
      replaceWithClosedUrl();
      return;
    }

    if (!urlState.isOpen) {
      const previousMarker = lastMarkerRef.current;
      if (
        isOpenRef.current &&
        isDirtyRef.current &&
        previousMarker?.origin === "launch" &&
        lastOpenHrefRef.current
      ) {
        window.history.pushState(
          withQuickBookHistoryMarker(
            window.history.state,
            previousMarker,
          ),
          "",
          lastOpenHrefRef.current,
        );
        setIsCloseConfirmationOpen(true);
        return;
      }
      resetClosedState();
      return;
    }

    let marker = readQuickBookHistoryMarker(window.history.state);
    const isNewDirectOpen = !marker;
    if (!marker) {
      marker = {
        version: 1,
        sessionId: createSessionId(),
        depth: 0,
        origin: "direct",
      };
      window.history.replaceState(
        withQuickBookHistoryMarker(window.history.state, marker),
        "",
        window.location.href,
      );
    }

    if (isNewDirectOpen || !isOpenRef.current) {
      const location = resolveQuickBookLocation(workspaceBootstrap);
      setPrefill({});
      setDraft(createGuidedBookingDraft());
      setIsDirtyState(false);
      isDirtyRef.current = false;
      isBusyRef.current = false;
      setSelectedLocationIdState(location?.id ?? null);
    }
    isOpenRef.current = true;
    lastMarkerRef.current = marker;
    lastOpenHrefRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setIsOpen(true);
    setCurrentStep(urlState.step);
    setIsCloseConfirmationOpen(false);
  }, [replaceWithClosedUrl, resetClosedState, workspaceBootstrap]);

  useEffect(() => {
    syncFromHistory();
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [syncFromHistory]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const location = resolveQuickBookLocation(
      workspaceBootstrap,
      selectedLocationId ?? undefined,
    );
    if (!location) {
      setBootstrap(null);
      setIsBootstrapLoading(false);
      setBootstrapError(
        selectedLocationId
          ? "You do not have permission to book at this clinic location."
          : "No clinic location is available for appointment booking.",
      );
      return;
    }

    if (selectedLocationId !== location.id) {
      setSelectedLocationIdState(location.id);
      return;
    }

    let active = true;
    setBootstrap(null);
    setBootstrapError(null);
    setIsBootstrapLoading(true);
    void loadBookingBootstrap(location.id)
      .then((data) => {
        if (!active) {
          return;
        }
        setBootstrap(data);
        setIsBootstrapLoading(false);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setBootstrap(null);
        setIsBootstrapLoading(false);
        setBootstrapError(
          "Booking details are temporarily unavailable. Try again.",
        );
      });

    return () => {
      active = false;
    };
  }, [
    bootstrapAttempt,
    isOpen,
    loadBookingBootstrap,
    selectedLocationId,
    workspaceBootstrap,
  ]);

  const openQuickBook = useCallback(
    (nextPrefill?: QuickBookPrefill) => {
      if (typeof window === "undefined") {
        return;
      }
      if (isOpenRef.current) {
        setIsMinimized(false);
        return;
      }
      const safePrefill = sanitizeQuickBookPrefill(nextPrefill);
      const initialStep = safePrefill.refs?.slotIso ? "details" : null;
      const location = resolveQuickBookLocation(
        workspaceBootstrap,
        safePrefill.locationId,
      );
      if (!location) {
        return;
      }
      const marker: QuickBookHistoryMarker = {
        ...(readQuickBookHistoryMarker(window.history.state) ?? {
          version: 1 as const,
          depth: 0,
          origin: "launch" as const,
        }),
        sessionId: createSessionId(),
      };
      const href = createQuickBookHref(window.location.href, initialStep);
      window.history[isOpenRef.current ? "replaceState" : "pushState"](
        withQuickBookHistoryMarker(window.history.state, marker),
        "",
        href,
      );

      isOpenRef.current = true;
      isDirtyRef.current = false;
      lastMarkerRef.current = marker;
      lastOpenHrefRef.current = href;
      setIsOpen(true);
      setCurrentStep(initialStep);
      setPrefill(safePrefill);
      setDraft(createGuidedBookingDraft(safePrefill));
      setIsDirtyState(false);
      setIsBusyState(false);
      setIsMinimized(false);
      setIsCloseConfirmationOpen(false);
      setSelectedLocationIdState(location.id);
      setBootstrap(null);
      setBootstrapError(null);
    },
    [workspaceBootstrap],
  );

  const closeQuickBook = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    isDirtyRef.current = false;
    setIsDirtyState(false);
    setIsCloseConfirmationOpen(false);
    const marker = readQuickBookHistoryMarker(window.history.state);
    const plan = planQuickBookClose(window.location.href, marker);
    if (plan.method === "replace") {
      window.history.replaceState(
        withoutQuickBookHistoryMarker(window.history.state),
        "",
        plan.href,
      );
      resetClosedState();
      return;
    }

    pendingDirectCloseRef.current = plan.replaceAfterGo;
    setIsOpen(false);
    window.history.go(plan.delta);
  }, [resetClosedState]);

  const requestClose = useCallback(() => {
    if (isBusyRef.current) {
      return false;
    }
    if (isDirtyRef.current) {
      closeTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setIsCloseConfirmationOpen(true);
      return false;
    }
    closeQuickBook();
    return true;
  }, [closeQuickBook]);

  const cancelClose = useCallback(() => {
    setIsCloseConfirmationOpen(false);
    const closeTrigger = closeTriggerRef.current;
    closeTriggerRef.current = null;
    window.setTimeout(() => closeTrigger?.focus(), 0);
  }, []);

  const setDirty = useCallback((nextIsDirty: boolean) => {
    isDirtyRef.current = nextIsDirty;
    setIsDirtyState(nextIsDirty);
    if (!nextIsDirty) {
      setIsCloseConfirmationOpen(false);
    }
  }, []);

  const setBusy = useCallback((nextIsBusy: boolean) => {
    isBusyRef.current = nextIsBusy;
    setIsBusyState(nextIsBusy);
    if (nextIsBusy) {
      setIsCloseConfirmationOpen(false);
    }
  }, []);

  const setStep = useCallback(
    (
      nextStep: QuickBookStepRef | null,
      options?: { replace?: boolean },
    ) => {
      if (typeof window === "undefined" || !isOpenRef.current) {
        return false;
      }
      if (isBusyRef.current) {
        return false;
      }
      const normalizedStep =
        nextStep === null ? null : normalizeQuickBookStepRef(nextStep);
      if (nextStep !== null && !normalizedStep) {
        return false;
      }
      if (normalizedStep === currentStep) {
        return true;
      }

      const existingMarker =
        readQuickBookHistoryMarker(window.history.state) ?? {
          version: 1 as const,
          sessionId: createSessionId(),
          depth: 0,
          origin: "direct" as const,
        };
      const marker = advanceQuickBookHistoryMarker(
        existingMarker,
        options?.replace,
      );
      if (!marker) {
        return false;
      }
      const href = createQuickBookHref(window.location.href, normalizedStep);
      const method = options?.replace ? "replaceState" : "pushState";
      window.history[method](
        withQuickBookHistoryMarker(window.history.state, marker),
        "",
        href,
      );
      lastMarkerRef.current = marker;
      lastOpenHrefRef.current = href;
      setCurrentStep(normalizedStep);
      return true;
    },
    [currentStep],
  );

  const back = useCallback(() => {
    if (typeof window === "undefined" || !isOpenRef.current) {
      return;
    }
    if (isBusyRef.current) {
      return;
    }
    const marker = readQuickBookHistoryMarker(window.history.state);
    if (marker && marker.depth > 0) {
      window.history.back();
      return;
    }
    requestClose();
  }, [requestClose]);

  const setSelectedLocationId = useCallback(
    (locationId: string) => {
      const location = resolveQuickBookLocation(
        workspaceBootstrap,
        locationId,
      );
      setBootstrap(null);
      if (!location) {
        setSelectedLocationIdState(locationId);
        setBootstrapError(
          "You do not have permission to book at this clinic location.",
        );
        return;
      }
      setBootstrapError(null);
      setSelectedLocationIdState(location.id);
    },
    [workspaceBootstrap],
  );

  const value = useMemo<QuickBookController>(
    () => ({
      isOpen,
      canOpen,
      currentStep,
      prefill,
      draft,
      isDirty,
      isBusy,
      isMinimized,
      isCloseConfirmationOpen,
      selectedLocationId,
      bootstrap,
      isBootstrapLoading,
      bootstrapError,
      openQuickBook,
      requestClose,
      closeQuickBook,
      confirmClose: closeQuickBook,
      cancelClose,
      back,
      setStep,
      setDraft,
      setDirty,
      setBusy,
      minimize: () => setIsMinimized(true),
      reopen: () => setIsMinimized(false),
      setSelectedLocationId,
      retryBootstrap: () => setBootstrapAttempt((attempt) => attempt + 1),
    }),
    [
      back,
      bootstrap,
      bootstrapError,
      canOpen,
      cancelClose,
      closeQuickBook,
      currentStep,
      draft,
      isBootstrapLoading,
      isCloseConfirmationOpen,
      isDirty,
      isBusy,
      isMinimized,
      isOpen,
      openQuickBook,
      prefill,
      requestClose,
      selectedLocationId,
      setDirty,
      setBusy,
      setSelectedLocationId,
      setStep,
    ],
  );

  return (
    <QuickBookContext.Provider value={value}>
      {children}
    </QuickBookContext.Provider>
  );
}

export function useQuickBook() {
  const context = useContext(QuickBookContext);
  if (!context) {
    throw new Error("useQuickBook must be used inside QuickBookProvider");
  }
  return context;
}

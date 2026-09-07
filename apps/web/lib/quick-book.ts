import type { WorkspaceBootstrap } from "@/lib/workspace-bootstrap";

export const QUICK_BOOK_QUERY_PARAM = "book";
export const QUICK_BOOK_STEP_QUERY_PARAM = "bookStep";

const MAX_STEP_REF_LENGTH = 48;
const MAX_HISTORY_DEPTH = 24;
const MAX_PREFILL_REFS = 8;
const MAX_PREFILL_REF_KEY_LENGTH = 32;
const MAX_PREFILL_REF_VALUE_LENGTH = 160;
const STEP_REF_PATTERN = /^[a-z][a-z0-9-]*$/;
const PREFILL_REF_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export type QuickBookStepRef = string;

/**
 * The controller deliberately knows nothing about Client-first or slot-first
 * workflow fields. Consumers may pass a small set of opaque record references,
 * which remain in memory and are never serialized into the URL.
 */
export type QuickBookPrefill = Readonly<{
  locationId?: string;
  refs?: Readonly<Record<string, string>>;
}>;

export type QuickBookHistoryMarker = {
  version: 1;
  sessionId: string;
  depth: number;
  origin: "launch" | "direct";
};

export type QuickBookUrlState = {
  isOpen: boolean;
  step: QuickBookStepRef | null;
};

export type QuickBookClosePlan =
  | {
      method: "go";
      delta: number;
      replaceAfterGo: boolean;
    }
  | {
      method: "replace";
      href: string;
    };

const QUICK_BOOK_HISTORY_KEY = "__clinicFlowQuickBook";
const LOCAL_URL_ORIGIN = "https://clinicflow.local";

function toUrl(value: string | URL) {
  return value instanceof URL ? new URL(value.href) : new URL(value, LOCAL_URL_ORIGIN);
}

function toRelativeHref(url: URL) {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shouldRestoreBusyQuickBookEntry({
  currentHref,
  isBusy,
  isOpen,
  lastOpenHref,
}: {
  currentHref: string;
  isBusy: boolean;
  isOpen: boolean;
  lastOpenHref: string | null;
}) {
  return Boolean(
    isOpen &&
      isBusy &&
      lastOpenHref &&
      currentHref !== lastOpenHref,
  );
}

export function normalizeQuickBookStepRef(
  value: string | null | undefined,
): QuickBookStepRef | null {
  const normalized = value?.trim() ?? "";
  if (
    !normalized ||
    normalized.length > MAX_STEP_REF_LENGTH ||
    !STEP_REF_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function readQuickBookUrl(value: string | URL): QuickBookUrlState {
  const url = toUrl(value);
  const isOpen = url.searchParams.get(QUICK_BOOK_QUERY_PARAM) === "1";
  return {
    isOpen,
    step: isOpen
      ? normalizeQuickBookStepRef(
          url.searchParams.get(QUICK_BOOK_STEP_QUERY_PARAM),
        )
      : null,
  };
}

export function createQuickBookHref(
  value: string | URL,
  step?: string | null,
) {
  const url = toUrl(value);
  url.searchParams.set(QUICK_BOOK_QUERY_PARAM, "1");
  const normalizedStep = normalizeQuickBookStepRef(step);
  if (normalizedStep) {
    url.searchParams.set(QUICK_BOOK_STEP_QUERY_PARAM, normalizedStep);
  } else {
    url.searchParams.delete(QUICK_BOOK_STEP_QUERY_PARAM);
  }
  return toRelativeHref(url);
}

export function createClosedQuickBookHref(value: string | URL) {
  const url = toUrl(value);
  url.searchParams.delete(QUICK_BOOK_QUERY_PARAM);
  url.searchParams.delete(QUICK_BOOK_STEP_QUERY_PARAM);
  return toRelativeHref(url);
}

export function sanitizeQuickBookPrefill(
  prefill?: QuickBookPrefill,
): QuickBookPrefill {
  const locationId = normalizeBoundedValue(prefill?.locationId);
  const refs = Object.entries(prefill?.refs ?? {})
    .filter(
      ([key, value]) =>
        key.length <= MAX_PREFILL_REF_KEY_LENGTH &&
        PREFILL_REF_KEY_PATTERN.test(key) &&
        Boolean(normalizeBoundedValue(value)),
    )
    .slice(0, MAX_PREFILL_REFS)
    .reduce<Record<string, string>>((result, [key, value]) => {
      result[key] = normalizeBoundedValue(value)!;
      return result;
    }, {});

  return {
    ...(locationId ? { locationId } : {}),
    ...(Object.keys(refs).length > 0 ? { refs } : {}),
  };
}

function normalizeBoundedValue(value?: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > MAX_PREFILL_REF_VALUE_LENGTH) {
    return null;
  }
  return normalized;
}

export function resolveQuickBookLocation(
  workspaceBootstrap: WorkspaceBootstrap,
  requestedLocationId?: string,
) {
  if (!workspaceBootstrap.context.capabilities.canCreateAppointment) {
    return null;
  }

  if (requestedLocationId) {
    return (
      workspaceBootstrap.locations.find(
        (location) =>
          location.id === requestedLocationId &&
          location.canCreateAppointment,
      ) ?? null
    );
  }

  return (
    workspaceBootstrap.locations.find(
      (location) => location.canCreateAppointment,
    ) ?? null
  );
}

export function withQuickBookHistoryMarker(
  historyState: unknown,
  marker: QuickBookHistoryMarker,
) {
  const base =
    historyState && typeof historyState === "object"
      ? (historyState as Record<string, unknown>)
      : {};
  const nextState: Record<string, unknown> = {
    ...base,
  };
  nextState[QUICK_BOOK_HISTORY_KEY] = marker;
  return nextState;
}

export function withoutQuickBookHistoryMarker(historyState: unknown) {
  if (!historyState || typeof historyState !== "object") {
    return {};
  }
  const nextState = { ...(historyState as Record<string, unknown>) };
  delete nextState[QUICK_BOOK_HISTORY_KEY];
  return nextState;
}

export function readQuickBookHistoryMarker(
  historyState: unknown,
): QuickBookHistoryMarker | null {
  if (!historyState || typeof historyState !== "object") {
    return null;
  }
  const marker = (historyState as Record<string, unknown>)[
    QUICK_BOOK_HISTORY_KEY
  ];
  if (!marker || typeof marker !== "object") {
    return null;
  }
  const candidate = marker as Partial<QuickBookHistoryMarker>;
  if (
    candidate.version !== 1 ||
    typeof candidate.sessionId !== "string" ||
    !candidate.sessionId ||
    candidate.sessionId.length > 160 ||
    !Number.isInteger(candidate.depth) ||
    (candidate.depth ?? -1) < 0 ||
    (candidate.depth ?? MAX_HISTORY_DEPTH + 1) > MAX_HISTORY_DEPTH ||
    (candidate.origin !== "launch" && candidate.origin !== "direct")
  ) {
    return null;
  }
  return candidate as QuickBookHistoryMarker;
}

export function advanceQuickBookHistoryMarker(
  marker: QuickBookHistoryMarker,
  replace = false,
) {
  if (replace) {
    return marker;
  }
  if (marker.depth >= MAX_HISTORY_DEPTH) {
    return null;
  }
  return {
    ...marker,
    depth: marker.depth + 1,
  };
}

export function planQuickBookClose(
  value: string | URL,
  marker: QuickBookHistoryMarker | null,
): QuickBookClosePlan {
  if (!marker) {
    return {
      method: "replace",
      href: createClosedQuickBookHref(value),
    };
  }

  if (marker.origin === "direct") {
    if (marker.depth === 0) {
      return {
        method: "replace",
        href: createClosedQuickBookHref(value),
      };
    }
    return {
      method: "go",
      delta: -marker.depth,
      replaceAfterGo: true,
    };
  }

  return {
    method: "go",
    delta: -(marker.depth + 1),
    replaceAfterGo: false,
  };
}

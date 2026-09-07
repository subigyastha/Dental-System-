"use client";

import { publishSessionEnd } from "@/lib/session-events";

// API calls stay same-origin. Next proxies this path to the Nest API before
// its intentionally disabled legacy route handlers can return 410.
const configuredApiBase = "/api";
const UNSAFE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const DEFAULT_API_TIMEOUT_MS = 8_000;

let csrfToken: string | null = null;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function normalizeApiBase(value: string) {
  return value.replace(/\/$/, "");
}

function apiUrl(path: string) {
  return `${normalizeApiBase(configuredApiBase)}${path}`;
}

function isUnsafeRequest(path: string, method?: string) {
  return UNSAFE_METHODS.has((method ?? "GET").toUpperCase()) && path !== "/auth/login";
}

function emitSessionExpired() {
  publishSessionEnd("expired");
}

async function fetchWithDeadline(url: string, init?: RequestInit) {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_API_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init?.signal?.aborted) {
      throw new ApiRequestError(
        "The server took too long to respond. Please try again.",
        408,
        "REQUEST_TIMEOUT",
      );
    }
    throw error;
  }
}

async function ensureCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  const response = await fetchWithDeadline(apiUrl("/auth/csrf"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) {
      csrfToken = null;
      emitSessionExpired();
    }
    throw new ApiRequestError("Could not establish a protected session request.", response.status);
  }

  const payload = (await response.json()) as { csrfToken?: string };
  if (!payload.csrfToken) {
    throw new ApiRequestError("The API did not provide a CSRF token.", 500);
  }

  csrfToken = payload.csrfToken;
  return csrfToken;
}

export function rememberCsrfToken(value?: string) {
  csrfToken = value ?? null;
}

/**
 * Compatibility wrapper for older call sites while they are migrated to the
 * cookie session transport. It deliberately never creates an Authorization
 * header; apiFetch supplies credentials and CSRF protection centrally.
 */
export function withSessionRequest(_session: unknown, init?: RequestInit) {
  return init ?? {};
}

export async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (isUnsafeRequest(path, init?.method)) {
    headers.set("x-csrf-token", await ensureCsrfToken());
  }

  const response = await fetchWithDeadline(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 401) {
    csrfToken = null;
    emitSessionExpired();
  }

  return response;
}

export async function apiFetchJson<T>(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}`;
    let message = fallbackMessage;
    let reason: string | undefined;
    let requestId: string | undefined;

    try {
      const payload = (await response.json()) as {
        error?: string | { message?: string; reason?: string };
        message?: string;
        meta?: { requestId?: string };
      };
      message =
        (typeof payload.error === "string" ? payload.error : payload.error?.message) ??
        payload.message ??
        fallbackMessage;
      reason =
        typeof payload.error === "object"
          ? payload.error.reason
          : undefined;
      requestId = payload.meta?.requestId;
    } catch {
      // Keep fallback message.
    }

    throw new ApiRequestError(
      message,
      response.status,
      reason,
      requestId,
    );
  }

  return (await response.json()) as T;
}

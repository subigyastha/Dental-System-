"use client";

const configuredApiBase = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const UNSAFE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

let csrfToken: string | null = null;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("clinicflow:session-expired"));
  }
}

async function ensureCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  const response = await fetch(apiUrl("/auth/csrf"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
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

  const response = await fetch(apiUrl(path), {
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

    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? fallbackMessage;
    } catch {
      // Keep fallback message.
    }

    throw new ApiRequestError(message, response.status);
  }

  return (await response.json()) as T;
}

"use client";

const configuredApiBase =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

let resolvedApiBase: string | null = null;

export const SESSION_TOKEN_STORAGE_KEY = "workflow-session-token";

function normalizeApiBase(value: string) {
  return value.replace(/\/$/, "");
}

function getApiCandidates() {
  const candidates = new Set<string>();
  candidates.add(normalizeApiBase(configuredApiBase));

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    for (const port of [4000, 4001, 4002, 4003, 4004, 4010]) {
      candidates.add(`${protocol}//${hostname}:${port}/api`);
    }
  }

  return Array.from(candidates);
}

export async function apiFetch(path: string, init?: RequestInit) {
  const bases = resolvedApiBase
    ? [resolvedApiBase, ...getApiCandidates().filter((base) => base !== resolvedApiBase)]
    : getApiCandidates();
  let fallbackResponse: Response | null = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, init);
      if (response.ok) {
        resolvedApiBase = base;
        return response;
      }

      if (response.status >= 500) {
        continue;
      }

      if (!fallbackResponse) {
        fallbackResponse = response;
      }
    } catch {
      // Try the next candidate.
    }
  }

  if (fallbackResponse) {
    return fallbackResponse;
  }

  return fetch(`/api${path}`, init);
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

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function withAuthHeaders(token?: string | null, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return {
    ...init,
    headers,
  };
}

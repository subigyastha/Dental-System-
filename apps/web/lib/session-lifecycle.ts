"use client";

import {
  ApiRequestError,
  apiFetchJson,
  rememberCsrfToken,
} from "@/lib/api-client";

/**
 * Ends the active cookie session only after the server confirms revocation.
 * A 401 is also terminal because the session is already absent or expired.
 */
export async function logoutCurrentSession() {
  try {
    await apiFetchJson<{ ok: true }>("/auth/logout", { method: "POST" });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      rememberCsrfToken();
      return "expired" as const;
    }
    throw error;
  }
  rememberCsrfToken();
  return "signed-out" as const;
}

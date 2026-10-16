import { API_WAKE_TIMEOUT_MS, ApiRequestError, apiFetchJson } from "./api-client";
import { requestErrorMessage } from "./request-error";

/** A resumed mobile PWA may be the first caller after the free API sleeps. */
export async function loadScheduleDay<T>(query: URLSearchParams): Promise<T> {
  const deadline = Date.now() + API_WAKE_TIMEOUT_MS;
  const path = `/v1/schedule/day?${query.toString()}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await apiFetchJson<{ data: T; meta: { apiVersion: string } }>(path, {
        cache: "no-store",
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      if (response.meta?.apiVersion !== "v1" || !response.data) {
        throw new Error("The schedule service returned an unsupported response. Refresh the app and try again.");
      }
      return response.data;
    } catch (error) {
      const transient = error instanceof TypeError || (error instanceof ApiRequestError &&
        (error.status === 408 || error.status >= 500));
      // Retry this GET once, within the original budget. Never retry a denied
      // session, permissions, validation, or a booking/payment write here.
      if (attempt > 0 || !transient || Date.now() >= deadline) throw error;
    }
  }
}

export function scheduleLoadErrorMessage(error: unknown) {
  if (error instanceof TypeError) return "Could not connect to the clinic service. Check your connection and retry the schedule.";
  return requestErrorMessage(error, "Provider availability could not be loaded. Try again.");
}

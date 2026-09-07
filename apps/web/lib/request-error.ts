import { ApiRequestError } from "@/lib/api-client";

export function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again and retry.";
    }
    if (error.status === 403) {
      return "You do not have permission to view this information.";
    }
    if (error.status === 404) {
      return "The requested information could not be found.";
    }
    if (error.status >= 500) {
      return "The clinic service is temporarily unavailable. Please retry.";
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export function isAbortedRequest(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

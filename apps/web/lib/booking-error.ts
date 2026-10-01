import { ApiRequestError } from "@/lib/api-client";

/** A transport failure cannot prove whether an idempotent booking write committed. */
export function isUncertainBookingWriteError(error: unknown) {
  return error instanceof TypeError || error instanceof SyntaxError ||
    (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof ApiRequestError &&
      (error.status === 0 || error.status === 408 || error.status >= 500));
}

const providerTimeConflictPatterns = [
  /slot no longer available/i,
  /outside provider availability/i,
];

/**
 * A 409 can also mean an inactive/merged Client, unsupported service, or an
 * inactive provider. Only genuine time conflicts should move the booking UI
 * into the availability picker.
 */
export function isProviderTimeConflict(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    providerTimeConflictPatterns.some((pattern) => pattern.test(error.message))
  );
}

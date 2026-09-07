import assert from "node:assert/strict";
import test from "node:test";

import { ApiRequestError } from "./api-client";
import { isAbortedRequest, requestErrorMessage } from "./request-error";

test("request errors distinguish authentication, permission, missing, and service failures", () => {
  assert.match(
    requestErrorMessage(new ApiRequestError("raw", 401), "fallback"),
    /session has expired/i,
  );
  assert.match(
    requestErrorMessage(new ApiRequestError("raw", 403), "fallback"),
    /permission/i,
  );
  assert.match(
    requestErrorMessage(new ApiRequestError("raw", 404), "fallback"),
    /could not be found/i,
  );
  assert.match(
    requestErrorMessage(new ApiRequestError("raw", 503), "fallback"),
    /temporarily unavailable/i,
  );
});

test("aborted requests are recognized without becoming visible errors", () => {
  const error = new Error("cancelled");
  error.name = "AbortError";
  assert.equal(isAbortedRequest(error), true);
  assert.equal(isAbortedRequest(new Error("network failed")), false);
});

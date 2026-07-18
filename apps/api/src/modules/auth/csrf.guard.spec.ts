import assert from "node:assert/strict";
import test from "node:test";

import { UnauthorizedException } from "@nestjs/common";

import { CsrfGuard } from "./csrf.guard";

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => "handler",
    getClass: () => "controller",
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

test("cookie-authenticated mutations reject a missing CSRF proof", async () => {
  const guard = new CsrfGuard(
    { getAllAndOverride: () => false } as never,
    { assertCsrfToken: async () => { throw new UnauthorizedException("Missing CSRF token"); } } as never,
  );

  await assert.rejects(
    guard.canActivate(context({ method: "PATCH", headers: { cookie: "clinicflow_session=opaque" } })),
    UnauthorizedException,
  );
});

test("cookie-authenticated mutations pass a matching CSRF proof", async () => {
  let proof: unknown;
  const guard = new CsrfGuard(
    { getAllAndOverride: () => false } as never,
    { assertCsrfToken: async (sessionToken: string, csrfToken: string) => { proof = { sessionToken, csrfToken }; } } as never,
  );

  assert.equal(
    await guard.canActivate(context({ method: "POST", headers: { cookie: "clinicflow_session=opaque", "x-csrf-token": "proof" } })),
    true,
  );
  assert.deepEqual(proof, { sessionToken: "opaque", csrfToken: "proof" });
});

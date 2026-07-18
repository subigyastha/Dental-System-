import assert from "node:assert/strict";
import test from "node:test";

import { UnauthorizedException } from "@nestjs/common";

import type { AuthSession } from "./auth.service";
import { SessionAuthGuard } from "./session-auth.guard";

const session: AuthSession = {
  id: "staff-a",
  organizationId: "clinic-a",
  name: "Clinic A Receptionist",
  email: "receptionist-a@example.test",
  role: "Receptionist",
};

function createContext(request: Record<string, unknown>) {
  return {
    getHandler: () => "handler",
    getClass: () => "controller",
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

test("default-deny guard rejects an operational route without a session", async () => {
  const guard = new SessionAuthGuard(
    { getAllAndOverride: () => false } as never,
    {
      requireSession: async () => {
        throw new UnauthorizedException("Missing session token");
      },
    } as never,
  );

  await assert.rejects(guard.canActivate(createContext({ headers: {} })), UnauthorizedException);
});

test("default-deny guard attaches the authenticated server session", async () => {
  const request: Record<string, unknown> = {
    headers: { authorization: "Bearer clinic-a-token" },
  };
  const guard = new SessionAuthGuard(
    { getAllAndOverride: () => false } as never,
    { requireSession: async () => session } as never,
  );

  assert.equal(await guard.canActivate(createContext(request)), true);
  assert.equal((request as { authSession?: AuthSession }).authSession?.organizationId, "clinic-a");
});

test("only an explicitly public action bypasses session validation", async () => {
  let calls = 0;
  const guard = new SessionAuthGuard(
    { getAllAndOverride: () => true } as never,
    {
      requireSession: async () => {
        calls += 1;
        return session;
      },
    } as never,
  );

  assert.equal(await guard.canActivate(createContext({ headers: {} })), true);
  assert.equal(calls, 0);
});

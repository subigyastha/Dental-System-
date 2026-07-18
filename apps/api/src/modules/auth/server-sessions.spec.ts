import assert from "node:assert/strict";
import test from "node:test";

import { UnauthorizedException } from "@nestjs/common";

import { AuthService } from "./auth.service";

const activeUser = {
  id: "user-a",
  organizationId: "clinic-a",
  name: "Clinic A Owner",
  email: "owner-a@example.test",
  passwordHash: "",
  status: "Active",
  role: "Owner",
  provider: null,
};

test("login persists only hashes for opaque session and CSRF secrets", async () => {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    user: {
      findFirst: async () => activeUser,
      update: async () => ({ id: activeUser.id }),
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      userSession: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: "session-a" }; } },
      user: { update: async () => ({ id: activeUser.id }) },
      auditLog: { create: async () => ({ id: "audit-a" }) },
    }),
  } as never;
  const auth = new AuthService(prisma);
  const correctPassword = ["correct", "password"].join("-");
  activeUser.passwordHash = auth.hashPassword(correctPassword);

  const result = await auth.login({ email: activeUser.email, password: correctPassword });

  assert.equal(created.length, 1);
  assert.notEqual(created[0].tokenHash, result.token);
  assert.notEqual(created[0].csrfTokenHash, result.csrfToken);
  assert.equal(typeof created[0].expiresAt, "object");
});

test("expired and revoked persisted sessions are rejected", async () => {
  for (const persisted of [
    { id: "expired", revokedAt: null, expiresAt: new Date(0) },
    { id: "revoked", revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  ]) {
    const prisma = {
      userSession: { findUnique: async () => ({ ...persisted, csrfTokenHash: "aa", user: activeUser }) },
    } as never;
    const auth = new AuthService(prisma);
    await assert.rejects(auth.sessionFromToken("opaque-token"), UnauthorizedException);
  }
});

test("CSRF validation accepts only the session-bound hashed secret", async () => {
  const auth = new AuthService({} as never);
  const csrfToken = "csrf-token";
  const csrfHash = (auth as unknown as { hashSessionToken: (value: string) => string }).hashSessionToken(csrfToken);
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "session-a",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        csrfTokenHash: csrfHash,
        user: activeUser,
      }),
    },
  } as never;
  const sessionAuth = new AuthService(prisma);

  await assert.doesNotReject(sessionAuth.assertCsrfToken("opaque-token", csrfToken));
  await assert.rejects(sessionAuth.assertCsrfToken("opaque-token", "wrong-token"), UnauthorizedException);
});

test("cookie helper is HttpOnly, SameSite, and secure in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const cookie = new AuthService({} as never).issueSessionCookie("opaque-token", new Date(Date.now() + 60_000));
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.secure, true);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

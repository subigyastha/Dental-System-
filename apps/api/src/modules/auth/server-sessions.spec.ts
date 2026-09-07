import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, UnauthorizedException } from "@nestjs/common";

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
      findMany: async () => [activeUser],
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
  activeUser.passwordHash = await auth.hashPassword(correctPassword);

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

test("login fails closed rather than choosing an arbitrary clinic for a duplicate email", async () => {
  const prisma = {
    user: {
      findMany: async () => [activeUser, { ...activeUser, id: "user-b", organizationId: "clinic-b" }],
    },
  } as never;
  const auth = new AuthService(prisma);
  const password = ["a long unique", "passphrase"].join(" ");

  await assert.rejects(auth.login({ email: activeUser.email, password }), UnauthorizedException);
});

test("sessions inactive for more than the idle timeout are rejected", async () => {
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "idle-session",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastSeenAt: new Date(Date.now() - 31 * 60_000),
        csrfTokenHash: "aa",
        user: activeUser,
      }),
    },
  } as never;
  const auth = new AuthService(prisma);

  await assert.rejects(auth.sessionFromToken("opaque-token"), UnauthorizedException);
});

test("active session reads do not write lastSeenAt inside the touch interval", async () => {
  let touchWrites = 0;
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "recent-session",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        lastSeenAt: new Date(),
        csrfTokenHash: "aa",
        user: activeUser,
      }),
      updateMany: async () => {
        touchWrites += 1;
        return { count: 1 };
      },
    },
  } as never;

  await new AuthService(prisma).sessionFromToken("opaque-token");
  assert.equal(touchWrites, 0);
});

test("concurrent stale session reads share one lastSeenAt write", async () => {
  let touchWrites = 0;
  let releaseTouch: (() => void) | undefined;
  const touchPending = new Promise<void>((resolve) => {
    releaseTouch = resolve;
  });
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "stale-session",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        lastSeenAt: new Date(Date.now() - 10 * 60_000),
        csrfTokenHash: "aa",
        user: activeUser,
      }),
      updateMany: async () => {
        touchWrites += 1;
        await touchPending;
        return { count: 1 };
      },
    },
  } as never;
  const auth = new AuthService(prisma);

  await Promise.all([
    auth.sessionFromToken("opaque-token"),
    auth.sessionFromToken("opaque-token"),
  ]);
  assert.equal(touchWrites, 1);
  releaseTouch?.();
});

test("concurrent and immediate session checks share the validated lookup", async () => {
  let lookupCount = 0;
  const prisma = {
    userSession: {
      findUnique: async () => {
        lookupCount += 1;
        await Promise.resolve();
        return {
          id: "cached-session",
          userId: activeUser.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60 * 60_000),
          lastSeenAt: new Date(),
          csrfTokenHash: "aa",
          user: activeUser,
        };
      },
    },
  } as never;
  const auth = new AuthService(prisma);

  await Promise.all([
    auth.sessionFromToken("opaque-token"),
    auth.sessionFromToken("opaque-token"),
  ]);
  await auth.sessionFromToken("opaque-token");

  assert.equal(lookupCount, 1);
});

test("new passwords need a non-common passphrase of at least 15 characters", async () => {
  const auth = new AuthService({} as never);
  await assert.rejects(auth.hashPassword("demo-password"), BadRequestException);
  await assert.rejects(auth.hashPassword("too-short"), BadRequestException);
  await assert.doesNotReject(auth.hashPassword("a long unique passphrase"));
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

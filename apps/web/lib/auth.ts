import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

import type { SessionUser } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

type SessionPayload = {
  sub: string;
  organizationId: string;
  role: string;
  providerId?: string;
  exp: number;
};

function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

function signToken(payload: SessionPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET ?? "local-dev-auth-secret")
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token: string): SessionPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid session token");
  }

  const expectedSignature = createHmac(
    "sha256",
    process.env.AUTH_SECRET ?? "local-dev-auth-secret",
  )
    .update(encodedPayload)
    .digest("base64url");

  if (
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    throw new Error("Invalid session token");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString(),
  ) as SessionPayload;

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Session expired");
  }

  return payload;
}

function toSessionUser(user: {
  id: string;
  organizationId: string | null;
  name: string;
  email: string;
  role: string;
  provider: { id: string } | null;
}): SessionUser {
  return {
    id: user.id,
    organizationId: user.organizationId ?? "",
    name: user.name,
    email: user.email,
    role: user.role as SessionUser["role"],
    providerId: user.provider?.id,
  };
}

const authUserSelect = {
  id: true,
  organizationId: true,
  name: true,
  email: true,
  passwordHash: true,
  status: true,
  role: true,
  provider: {
    select: {
      id: true,
    },
  },
} as const;

export async function loginWithCredentials(email: string, password: string) {
  if (!process.env.DATABASE_URL) {
    return { error: "Database is not configured", status: 503 as const };
  }

  let user;
  try {
    user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        status: "Active",
      },
      select: authUserSelect,
    });
  } catch {
    return { error: "Database is unreachable", status: 503 as const };
  }

  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid email or password", status: 401 as const };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  } catch {
    // Older databases may not have the staff-login metadata columns yet.
  }

  const session = toSessionUser(user);
  const token = signToken({
    sub: user.id,
    organizationId: user.organizationId ?? "",
    role: user.role,
    providerId: user.provider?.id,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  });

  return { token, user: session };
}

export async function sessionFromAuthorization(authorization?: string | null) {
  if (!process.env.DATABASE_URL) {
    return { error: "Database is not configured", status: 503 as const };
  }

  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { error: "Missing session token", status: 401 as const };
  }

  let payload: SessionPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return { error: "Invalid session token", status: 401 as const };
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect,
    });
  } catch {
    return { error: "Database is unreachable", status: 503 as const };
  }

  if (!user || user.status !== "Active") {
    return { error: "Invalid session", status: 401 as const };
  }

  return { user: toSessionUser(user) };
}

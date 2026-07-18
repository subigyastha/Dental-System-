import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";

export const SESSION_COOKIE_NAME = "clinicflow_session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AuthSession = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  providerId?: string;
};

export type AuthSessionReference = AuthSession | string | undefined;

export type SessionMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

export type IssuedSession = {
  token: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
  user: AuthSession;
};

export type SessionCookie = {
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    expires: Date;
    maxAge: number;
  };
};

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

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: LoginDto, metadata?: SessionMetadata) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        status: "Active",
      },
      select: authUserSelect,
    });

    if (!user?.passwordHash || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const issued = await this.createSession(user, metadata);
    return {
      // The controller exchanges this opaque value for an HttpOnly cookie. It
      // must not be exposed in the final browser response body.
      token: issued.token,
      user: issued.user,
      csrfToken: issued.csrfToken,
      session: { id: issued.sessionId, expiresAt: issued.expiresAt.toISOString() },
    };
  }

  async sessionFromAuthorization(authorization?: string) {
    return this.requireSession(authorization);
  }

  async sessionFromToken(token?: string) {
    return this.requireSessionToken(token);
  }

  async requireSession(reference?: AuthSessionReference): Promise<AuthSession> {
    if (reference && typeof reference !== "string") {
      return reference;
    }

    const authorization = reference;
    const token = this.extractBearerToken(authorization);
    return this.requireSessionToken(token);
  }

  async requireSessionToken(token?: string): Promise<AuthSession> {
    const persisted = await this.findActiveSession(token);
    this.touchSession(persisted.id);
    return this.mapUser(persisted.user);
  }

  async rotateCsrfToken(authorization?: string) {
    return this.rotateCsrfTokenForSessionToken(this.extractBearerToken(authorization));
  }

  async rotateCsrfTokenForSessionToken(token?: string) {
    const persisted = await this.findActiveSession(token);
    const csrfToken = this.newCsrfToken();
    await this.prisma.userSession.update({
      where: { id: persisted.id },
      data: { csrfTokenHash: this.hashSessionToken(csrfToken), lastSeenAt: new Date() },
    });
    return csrfToken;
  }

  async assertCsrfToken(sessionToken: string | undefined, csrfToken: string | undefined) {
    if (!csrfToken) {
      throw new UnauthorizedException("Missing CSRF token");
    }
    const persisted = await this.findActiveSession(sessionToken);
    const expected = Buffer.from(persisted.csrfTokenHash, "hex");
    const candidate = Buffer.from(this.hashSessionToken(csrfToken), "hex");
    if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
      throw new UnauthorizedException("Invalid CSRF token");
    }
    return this.mapUser(persisted.user);
  }

  async rotateSession(authorization?: string, metadata?: SessionMetadata): Promise<IssuedSession> {
    const token = this.extractBearerToken(authorization);
    const persisted = await this.findActiveSession(token);
    const now = new Date();
    const nextToken = this.newSessionToken();
    const nextCsrfToken = this.newCsrfToken();
    const expiresAt = this.sessionExpiry(now);

    const replacement = await this.prisma.$transaction(async (tx) => {
      const active = await tx.userSession.findFirst({
        where: { id: persisted.id, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!active) {
        throw new UnauthorizedException("Session is no longer active");
      }

      const created = await tx.userSession.create({
        data: {
          userId: persisted.user.id,
          tokenHash: this.hashSessionToken(nextToken),
          csrfTokenHash: this.hashSessionToken(nextCsrfToken),
          expiresAt,
          lastSeenAt: now,
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
        },
      });
      await tx.userSession.update({
        where: { id: persisted.id },
        data: {
          revokedAt: now,
          revokedReason: "rotated",
          rotatedAt: now,
          replacedBySessionId: created.id,
        },
      });
      await this.writeSessionAudit(tx, persisted.user, "session_rotated", created.id);
      return created;
    });

    return {
      token: nextToken,
      csrfToken: nextCsrfToken,
      sessionId: replacement.id,
      expiresAt,
      user: this.mapUser(persisted.user),
    };
  }

  async logout(authorization?: string, reason = "logout") {
    return this.logoutSessionToken(this.extractBearerToken(authorization), reason);
  }

  async logoutSessionToken(token?: string, reason = "logout") {
    const persisted = await this.findActiveSession(token);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: persisted.id },
        data: { revokedAt: now, revokedReason: reason },
      });
      await this.writeSessionAudit(tx, persisted.user, "session_revoked", persisted.id, reason);
    });
    return { ok: true };
  }

  async revokeAllSessionsForUser(userId: string, reason = "security_reset") {
    return this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  issueSessionCookie(token: string, expiresAt: Date): SessionCookie {
    return {
      name: SESSION_COOKIE_NAME,
      value: token,
      options: {
        httpOnly: true,
        secure: this.isSecureCookieRequired(),
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
        maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
      },
    };
  }

  clearSessionCookie(): Omit<SessionCookie, "value"> & { value: "" } {
    return {
      name: SESSION_COOKIE_NAME,
      value: "",
      options: {
        httpOnly: true,
        secure: this.isSecureCookieRequired(),
        sameSite: "lax",
        path: "/",
        expires: new Date(0),
        maxAge: 0,
      },
    };
  }

  hashPassword(password: string) {
    const salt = randomBytes(8).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
  }

  private async createSession(
    user: {
      id: string;
      organizationId: string | null;
      name: string;
      email: string;
      role: string;
      provider: { id: string } | null;
    },
    metadata?: SessionMetadata,
  ): Promise<IssuedSession> {
    const now = new Date();
    const token = this.newSessionToken();
    const csrfToken = this.newCsrfToken();
    const expiresAt = this.sessionExpiry(now);
    const created = await this.prisma.$transaction(async (tx) => {
      const session = await tx.userSession.create({
        data: {
          userId: user.id,
          tokenHash: this.hashSessionToken(token),
          csrfTokenHash: this.hashSessionToken(csrfToken),
          expiresAt,
          lastSeenAt: now,
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      await this.writeSessionAudit(tx, user, "session_created", session.id);
      return session;
    });

    return { token, csrfToken, sessionId: created.id, expiresAt, user: this.mapUser(user) };
  }

  private async findActiveSession(token?: string) {
    if (!token) {
      throw new UnauthorizedException("Missing session token");
    }
    const persisted = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashSessionToken(token) },
      include: { user: { select: authUserSelect } },
    });
    if (!persisted || persisted.revokedAt || persisted.expiresAt <= new Date() || persisted.user.status !== "Active") {
      throw new UnauthorizedException("Invalid session");
    }
    return persisted;
  }

  private touchSession(sessionId: string) {
    void this.prisma.userSession.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    }).catch(() => undefined);
  }

  private async writeSessionAudit(
    tx: Prisma.TransactionClient,
    user: { id: string; organizationId: string | null },
    action: string,
    sessionId: string,
    reason?: string,
  ) {
    if (!user.organizationId) {
      return;
    }
    await tx.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        entityType: "user_session",
        entityId: sessionId,
        action,
        description: reason,
      },
    });
  }

  private mapUser(user: {
    id: string;
    organizationId: string | null;
    name: string;
    email: string;
    role: string;
    provider: { id: string } | null;
  }): AuthSession {
    return {
      id: user.id,
      organizationId: user.organizationId ?? "",
      name: user.name,
      email: user.email,
      role: user.role,
      providerId: user.provider?.id,
    };
  }

  private verifyPassword(password: string, stored: string) {
    const [scheme, salt, hash] = stored.split(":");
    if (scheme !== "scrypt" || !salt || !hash) {
      return false;
    }
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  }

  private extractBearerToken(authorization?: string) {
    return authorization?.replace(/^Bearer\s+/i, "");
  }

  private newSessionToken() {
    return randomBytes(32).toString("base64url");
  }

  private newCsrfToken() {
    return randomBytes(32).toString("base64url");
  }

  private hashSessionToken(token: string) {
    const secret = process.env.AUTH_SECRET;
    if (secret) {
      return createHmac("sha256", secret).update(token).digest("hex");
    }
    if (this.isProductionRuntime()) {
      throw new InternalServerErrorException("AUTH_SECRET must be configured in production");
    }
    // Development uses a one-way token hash, not a reusable signing fallback.
    return createHash("sha256").update(token).digest("hex");
  }

  private sessionExpiry(now: Date) {
    return new Date(now.getTime() + this.sessionTtlSeconds() * 1_000);
  }

  private sessionTtlSeconds() {
    const configured = Number(process.env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_SECONDS;
  }

  private isSecureCookieRequired() {
    return this.isProductionRuntime() || process.env.SESSION_COOKIE_SECURE === "true";
  }

  private isProductionRuntime() {
    return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER) || Boolean(process.env.VERCEL);
  }
}

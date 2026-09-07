import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { AuthorizationPolicyService } from "./authorization-policy.service";

export const SESSION_COOKIE_NAME = "clinicflow_session";
export const ROLE_ASSIGNMENT_ENFORCEMENT_ENV = "ROLE_ASSIGNMENT_ENFORCEMENT";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;
const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 60 * 30;
const DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 60 * 5;
const SESSION_LOOKUP_CACHE_TTL_MS = 5_000;
const MAX_SESSION_LOOKUP_CACHE_ENTRIES = 500;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const COMMON_PASSWORDS = new Set([
  "demo-password",
  "password",
  "password123",
  "12345678",
  "qwerty123",
  "welcome123",
  "admin123",
]);

function deriveScrypt(
  password: string,
  salt: string,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export type AuthSession = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  providerId?: string;
  /** Effective organization roles: scalar only until the explicit rollout is enabled. */
  effectiveRoles?: string[];
  effectiveRoleScopes?: Array<{ role: string; locationId: string | null }>;
  authorizationRoleSource?: "legacy_scalar" | "assignment_policy" | "legacy_dual_read" | "platform" | "no_effective_roles";
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

type PersistedAuthSession = Prisma.UserSessionGetPayload<{
  include: { user: { select: typeof authUserSelect } };
}>;

type SessionLookupCacheEntry = {
  value: PersistedAuthSession;
  expiresAt: number;
};

@Injectable()
export class AuthService {
  private readonly pendingSessionTouches = new Map<string, Promise<unknown>>();
  private readonly pendingSessionLookups = new Map<string, Promise<PersistedAuthSession>>();
  private readonly sessionLookupCache = new Map<string, SessionLookupCacheEntry>();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(AuthorizationPolicyService)
    private readonly policy?: AuthorizationPolicyService,
  ) {}

  async login(dto: LoginDto, metadata?: SessionMetadata) {
    const matchingUsers = await this.prisma.user.findMany({
      where: {
        email: dto.email.toLowerCase(),
        status: "Active",
      },
      select: authUserSelect,
      take: 2,
    });
    // An email can currently exist in more than one organization. Never select
    // an arbitrary tenant record during authentication; an explicit tenant
    // selector / global identity is required before supporting that scenario.
    const user = matchingUsers.length === 1 ? matchingUsers[0] : undefined;

    const password = user?.passwordHash
      ? await this.verifyPassword(dto.password, user.passwordHash)
      : { valid: false, needsUpgrade: false };
    if (!user || !password.valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (password.needsUpgrade) {
      // Legacy credentials are re-hashed after a successful sign-in without
      // retroactively locking out a user. New or reset passwords always pass
      // the current policy through the public hashPassword method.
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPasswordValue(dto.password) } });
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
      return reference.effectiveRoles ? reference : this.withEffectiveRoles(reference);
    }

    const authorization = reference;
    const token = this.extractBearerToken(authorization);
    return this.requireSessionToken(token);
  }

  async requireSessionToken(token?: string): Promise<AuthSession> {
    const persisted = await this.findActiveSession(token);
    this.touchSession(persisted.id, persisted.lastSeenAt);
    return this.withEffectiveRoles(this.mapUser(persisted.user));
  }

  async rotateCsrfToken(authorization?: string) {
    return this.rotateCsrfTokenForSessionToken(this.extractBearerToken(authorization));
  }

  async rotateCsrfTokenForSessionToken(token?: string) {
    const persisted = await this.findActiveSession(token, false);
    const csrfToken = this.newCsrfToken();
    await this.prisma.userSession.update({
      where: { id: persisted.id },
      data: { csrfTokenHash: this.hashSessionToken(csrfToken), lastSeenAt: new Date() },
    });
    this.invalidateSessionLookup(token);
    return csrfToken;
  }

  async assertCsrfToken(sessionToken: string | undefined, csrfToken: string | undefined) {
    if (!csrfToken) {
      throw new UnauthorizedException("Missing CSRF token");
    }
    const persisted = await this.findActiveSession(sessionToken, false);
    const expected = Buffer.from(persisted.csrfTokenHash, "hex");
    const candidate = Buffer.from(this.hashSessionToken(csrfToken), "hex");
    if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
      throw new UnauthorizedException("Invalid CSRF token");
    }
    return this.withEffectiveRoles(this.mapUser(persisted.user));
  }

  async rotateSession(authorization?: string, metadata?: SessionMetadata): Promise<IssuedSession> {
    const token = this.extractBearerToken(authorization);
    const persisted = await this.findActiveSession(token, false);
    this.invalidateSessionLookup(token);
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
      user: await this.withEffectiveRoles(this.mapUser(persisted.user)),
    };
  }

  async logout(authorization?: string, reason = "logout") {
    return this.logoutSessionToken(this.extractBearerToken(authorization), reason);
  }

  async logoutSessionToken(token?: string, reason = "logout") {
    const persisted = await this.findActiveSession(token, false);
    this.invalidateSessionLookup(token);
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
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    for (const [key, entry] of this.sessionLookupCache) {
      if (entry.value.userId === userId) this.sessionLookupCache.delete(key);
    }
    // A pending lookup has not produced a user projection yet, so it cannot be
    // filtered safely. Clearing the small map prevents it from repopulating a
    // just-revoked session cache.
    this.pendingSessionLookups.clear();
    return result;
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

  async hashPassword(password: string) {
    this.assertPasswordPolicy(password);
    return this.hashPasswordValue(password);
  }

  private async hashPasswordValue(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = await deriveScrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      this.scryptOptions(),
    );
    return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString("hex")}`;
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

    return { token, csrfToken, sessionId: created.id, expiresAt, user: await this.withEffectiveRoles(this.mapUser(user)) };
  }

  private async findActiveSession(token?: string, allowCache = true) {
    if (!token) {
      throw new UnauthorizedException("Missing session token");
    }
    const tokenHash = this.hashSessionToken(token);
    if (allowCache) {
      const cached = this.readSessionLookupCache(tokenHash);
      if (cached) {
        return this.assertActiveSession(cached);
      }
      const activeRequest = this.pendingSessionLookups.get(tokenHash);
      if (activeRequest) return activeRequest;
    }

    const request = this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: { select: authUserSelect } },
    }).then((persisted) => {
      const active = this.assertActiveSession(persisted);
      if (allowCache && this.pendingSessionLookups.get(tokenHash) === request) {
        this.writeSessionLookupCache(tokenHash, active);
      }
      return active;
    }).finally(() => {
      if (this.pendingSessionLookups.get(tokenHash) === request) {
        this.pendingSessionLookups.delete(tokenHash);
      }
    });
    if (allowCache) this.pendingSessionLookups.set(tokenHash, request);
    return request;
  }

  private assertActiveSession(persisted: PersistedAuthSession | null) {
    const now = new Date();
    if (!persisted || persisted.revokedAt || persisted.expiresAt <= now || this.isSessionIdle(persisted.lastSeenAt, now) || persisted.user.status !== "Active") {
      throw new UnauthorizedException("Invalid session");
    }
    return persisted;
  }

  private readSessionLookupCache(tokenHash: string) {
    const entry = this.sessionLookupCache.get(tokenHash);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.sessionLookupCache.delete(tokenHash);
      return null;
    }
    this.sessionLookupCache.delete(tokenHash);
    this.sessionLookupCache.set(tokenHash, entry);
    return entry.value;
  }

  private writeSessionLookupCache(tokenHash: string, value: PersistedAuthSession) {
    this.sessionLookupCache.delete(tokenHash);
    this.sessionLookupCache.set(tokenHash, {
      value,
      expiresAt: Date.now() + SESSION_LOOKUP_CACHE_TTL_MS,
    });
    while (this.sessionLookupCache.size > MAX_SESSION_LOOKUP_CACHE_ENTRIES) {
      const oldest = this.sessionLookupCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessionLookupCache.delete(oldest);
    }
  }

  private invalidateSessionLookup(token?: string) {
    if (!token) return;
    const tokenHash = this.hashSessionToken(token);
    this.sessionLookupCache.delete(tokenHash);
    this.pendingSessionLookups.delete(tokenHash);
  }

  private touchSession(sessionId: string, lastSeenAt: Date | null) {
    const now = new Date();
    const intervalMs = this.sessionTouchIntervalSeconds() * 1_000;
    if (lastSeenAt && lastSeenAt.getTime() + intervalMs > now.getTime()) {
      return;
    }
    if (this.pendingSessionTouches.has(sessionId)) {
      return;
    }

    const staleBefore = new Date(now.getTime() - intervalMs);
    const request = this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: staleBefore } }],
      },
      data: { lastSeenAt: now },
    }).catch(() => undefined).finally(() => {
      this.pendingSessionTouches.delete(sessionId);
    });
    this.pendingSessionTouches.set(sessionId, request);
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

  private async withEffectiveRoles(session: AuthSession): Promise<AuthSession> {
    if (!this.isRoleAssignmentEnforcementEnabled()) {
      return { ...session, effectiveRoles: [session.role], effectiveRoleScopes: [{ role: session.role, locationId: null }], authorizationRoleSource: "legacy_scalar" };
    }
    // Platform users do not participate in organization membership policy.
    if (session.role === "SuperAdmin") {
      return { ...session, effectiveRoles: [session.role], effectiveRoleScopes: [{ role: session.role, locationId: null }], authorizationRoleSource: "platform" };
    }
    if (!session.organizationId || !this.policy) {
      // Under rollout, never silently fall back to a scalar role when the
      // membership policy cannot be evaluated.
      return { ...session, effectiveRoles: [], effectiveRoleScopes: [], authorizationRoleSource: "no_effective_roles" };
    }
    const context = await this.policy.resolveContext(session.id, session.organizationId);
    return {
      ...session,
      effectiveRoles: context.roles,
      effectiveRoleScopes: context.roleScopes,
      authorizationRoleSource: context.source === "assignments"
        ? "assignment_policy"
        : context.source === "legacy-quarantined"
          ? "legacy_dual_read"
          : "no_effective_roles",
    };
  }

  private isRoleAssignmentEnforcementEnabled() {
    return process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV] === "true";
  }

  private async verifyPassword(password: string, stored: string) {
    const versioned = stored.split("$");
    if (versioned.length === 7 && versioned[0] === "scrypt" && versioned[1] === "v1") {
      const [, , rawN, rawR, rawP, salt, hash] = versioned;
      return {
        valid: await this.matchesScryptHash(password, salt, hash, Number(rawN), Number(rawR), Number(rawP)),
        needsUpgrade: Number(rawN) !== SCRYPT_N || Number(rawR) !== SCRYPT_R || Number(rawP) !== SCRYPT_P,
      };
    }

    // Backward compatibility for deployed `scrypt:<salt>:<hash>` records. A
    // successful legacy login is transparently re-hashed with the current cost.
    const [scheme, salt, hash] = stored.split(":");
    return {
      valid: scheme === "scrypt" && Boolean(salt) && Boolean(hash) && await this.matchesScryptHash(password, salt, hash, 2 ** 14, 8, 1),
      needsUpgrade: true,
    };
  }

  private async matchesScryptHash(password: string, salt: string, hash: string, N: number, r: number, p: number) {
    if (!salt || !hash || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 ** 14 || N > SCRYPT_N || r < 8 || r > 16 || p < 1 || p > 4) {
      return false;
    }
    try {
      const candidate = await deriveScrypt(
        password,
        salt,
        SCRYPT_KEY_LENGTH,
        this.scryptOptions(N, r, p),
      );
      const expected = Buffer.from(hash, "hex");
      return expected.length === candidate.length && timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  }

  private assertPasswordPolicy(password: string) {
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH || password.includes("\0") || COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new BadRequestException(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and must not be a commonly used password`);
    }
  }

  private scryptOptions(N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P) {
    return { N, r, p, maxmem: SCRYPT_MAX_MEMORY };
  }

  private isSessionIdle(lastSeenAt: Date | null, now: Date) {
    return Boolean(lastSeenAt && lastSeenAt.getTime() + this.sessionIdleTimeoutSeconds() * 1_000 <= now.getTime());
  }

  private sessionIdleTimeoutSeconds() {
    const configured = Number(process.env.SESSION_IDLE_TIMEOUT_SECONDS ?? DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS;
  }

  private sessionTouchIntervalSeconds() {
    const configured = Number(
      process.env.SESSION_TOUCH_INTERVAL_SECONDS ??
        DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS,
    );
    const requested = Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS;
    return Math.max(
      1,
      Math.min(requested, Math.floor(this.sessionIdleTimeoutSeconds() / 3)),
    );
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

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";

type SessionPayload = {
  sub: string;
  organizationId: string;
  role: string;
  providerId?: string;
  exp: number;
};

export type AuthSession = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  providerId?: string;
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

  async login(dto: LoginDto) {
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

    const session: AuthSession = {
      id: user.id,
      organizationId: user.organizationId ?? "",
      name: user.name,
      email: user.email,
      role: user.role,
      providerId: user.provider?.id,
    };

    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    } catch {
      // Older databases may not have the staff-login metadata columns yet.
    }

    return {
      token: this.signToken({
        sub: user.id,
        organizationId: user.organizationId ?? "",
        role: user.role,
        providerId: user.provider?.id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
      }),
      user: session,
    };
  }

  async sessionFromAuthorization(authorization?: string) {
    const session = await this.requireSession(authorization);
    return session;
  }

  async requireSession(authorization?: string): Promise<AuthSession> {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      throw new UnauthorizedException("Missing session token");
    }

    const payload = this.verifyToken(token);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: authUserSelect,
    });

    if (!user || user.status !== "Active") {
      throw new UnauthorizedException("Invalid session");
    }

    return {
      id: user.id,
      organizationId: user.organizationId ?? payload.organizationId,
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

  hashPassword(password: string) {
    const salt = randomBytes(8).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
  }

  private signToken(payload: SessionPayload) {
    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = this.signature(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): SessionPayload {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new UnauthorizedException("Invalid session token");
    }

    const expectedSignature = this.signature(encodedPayload);
    if (
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )
    ) {
      throw new UnauthorizedException("Invalid session token");
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString()) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("Session expired");
    }

    return payload;
  }

  private signature(value: string) {
    return createHmac("sha256", process.env.AUTH_SECRET ?? "local-dev-auth-secret")
      .update(value)
      .digest("base64url");
  }

  private toBase64Url(value: string) {
    return Buffer.from(value).toString("base64url");
  }
}

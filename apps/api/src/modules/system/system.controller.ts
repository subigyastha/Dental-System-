import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";

@Controller("system")
export class SystemController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  @Get("status")
  async status(@ServiceSession() authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    if (!process.env.DATABASE_URL) {
      return {
        databaseConfigured: false,
        provider: null,
        persistenceMode: "seeded-local",
        organizationCount: 0,
      };
    }

    try {
      const organizationCount = await this.prisma.organization.count({
        where: { id: session.organizationId },
      });

      return {
        databaseConfigured: true,
        provider: "postgresql",
        persistenceMode: "database-connected",
        organizationCount,
      };
    } catch {
      throw new ServiceUnavailableException({
        databaseConfigured: true,
        provider: "postgresql",
        persistenceMode: "database-unreachable",
        organizationCount: 0,
      });
    }
  }
}

import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Controller("system")
export class SystemController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  @Get("status")
  async status() {
    if (!process.env.DATABASE_URL) {
      return {
        databaseConfigured: false,
        provider: null,
        persistenceMode: "seeded-local",
        organizationCount: 0,
      };
    }

    try {
      const organizationCount = await this.prisma.organization.count();

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

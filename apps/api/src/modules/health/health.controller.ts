import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import { PublicRoute } from "../auth/public-route.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  @Get("live")
  @PublicRoute()
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  @PublicRoute()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "reachable" };
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        database: "unreachable",
      });
    }
  }
}

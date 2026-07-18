import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DashboardV1Controller } from "./dashboard-v1.controller";
import { DashboardBootstrapService } from "./dashboard-bootstrap.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DashboardV1Controller],
  providers: [DashboardBootstrapService],
})
export class ApiV1Module {}

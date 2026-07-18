import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SystemController } from "./system.controller";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SystemController],
})
export class SystemModule {}

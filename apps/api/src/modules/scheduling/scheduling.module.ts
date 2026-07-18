import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { ScheduleCacheService } from "./schedule-cache.service";
import { SchedulingService } from "./scheduling.service";

@Module({
  imports: [PrismaModule],
  providers: [ScheduleCacheService, SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}

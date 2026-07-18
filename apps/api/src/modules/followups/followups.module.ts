import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FollowupsController } from "./followups.controller";
import { FollowupsService } from "./followups.service";

@Module({
  imports: [AuthModule],
  controllers: [FollowupsController],
  providers: [FollowupsService],
})
export class FollowupsModule {}

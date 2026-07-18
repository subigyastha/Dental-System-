import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { OperationalDataController } from "./operational-data.controller";
import { OperationalDataService } from "./operational-data.service";

@Module({
  imports: [AuthModule],
  controllers: [OperationalDataController],
  providers: [OperationalDataService],
})
export class OperationalDataModule {}

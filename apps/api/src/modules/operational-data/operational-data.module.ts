import { Module } from "@nestjs/common";

import { OperationalDataController } from "./operational-data.controller";
import { OperationalDataService } from "./operational-data.service";

@Module({
  controllers: [OperationalDataController],
  providers: [OperationalDataService],
})
export class OperationalDataModule {}

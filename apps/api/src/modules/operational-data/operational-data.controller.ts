import { Controller, Get, Inject } from "@nestjs/common";

import { OperationalDataService } from "./operational-data.service";

@Controller("operational-data")
export class OperationalDataController {
  constructor(
    @Inject(OperationalDataService)
    private readonly operationalData: OperationalDataService,
  ) {}

  @Get()
  getOperationalData() {
    return this.operationalData.getOperationalData();
  }
}

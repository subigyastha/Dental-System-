import { Controller, Get, Headers, Inject } from "@nestjs/common";

import { OperationalDataService } from "./operational-data.service";

@Controller("operational-data")
export class OperationalDataController {
  constructor(
    @Inject(OperationalDataService)
    private readonly operationalData: OperationalDataService,
  ) {}

  @Get()
  getOperationalData(@Headers("authorization") authorization?: string) {
    return this.operationalData.getOperationalData(authorization);
  }
}

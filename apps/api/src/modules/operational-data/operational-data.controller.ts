import { Controller, Get, Inject } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { OperationalDataService } from "./operational-data.service";

@Controller("operational-data")
export class OperationalDataController {
  constructor(
    @Inject(OperationalDataService)
    private readonly operationalData: OperationalDataService,
  ) {}

  @Get()
  getOperationalData(@ServiceSession() authorization?: string) {
    return this.operationalData.getOperationalData(authorization);
  }
}

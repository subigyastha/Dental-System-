import { Controller, Get, Inject, Query, Req, UseFilters } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { DashboardBootstrapQueryDto } from "./dto/dashboard-bootstrap-query.dto";
import { DashboardBootstrapService } from "./dashboard-bootstrap.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/dashboard")
@UseFilters(V1ExceptionFilter)
export class DashboardV1Controller {
  constructor(@Inject(DashboardBootstrapService) private readonly dashboard: DashboardBootstrapService) {}

  @Get("bootstrap")
  async bootstrap(
    @Query() query: DashboardBootstrapQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.dashboard.getBootstrap(query.limit, authorization), request.requestId);
  }
}

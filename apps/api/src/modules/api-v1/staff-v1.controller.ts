import { Controller, Get, Inject, Param, Query, Req, UseFilters } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { StaffDirectoryQueryDto } from "./dto/staff-directory.dto";
import { StaffDirectoryService } from "./staff-directory.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/staff")
@UseFilters(V1ExceptionFilter)
export class StaffV1Controller {
  constructor(
    @Inject(StaffDirectoryService)
    private readonly staff: StaffDirectoryService,
  ) {}

  @Get()
  async list(
    @Query() query: StaffDirectoryQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.staff.list(query, authorization), request.requestId);
  }

  @Get(":id")
  async detail(
    @Param("id") id: string,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.staff.detail(id, authorization), request.requestId);
  }
}

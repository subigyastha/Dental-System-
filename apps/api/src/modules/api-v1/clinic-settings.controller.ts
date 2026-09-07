import { Body, Controller, Get, Inject, Patch, Req, UseFilters } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { ClinicSettingsService } from "./clinic-settings.service";
import { UpdateClinicSettingsDto } from "./dto/clinic-settings.dto";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/settings")
@UseFilters(V1ExceptionFilter)
export class ClinicSettingsController {
  constructor(
    @Inject(ClinicSettingsService)
    private readonly settings: ClinicSettingsService,
  ) {}

  @Get()
  async get(
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.settings.get(authorization),
      request.requestId,
    );
  }

  @Patch()
  async update(
    @Body() dto: UpdateClinicSettingsDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.settings.update(dto, authorization),
      request.requestId,
    );
  }
}

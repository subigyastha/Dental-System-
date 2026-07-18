import { Body, Controller, Inject, Param, Patch } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { OrganizationsService } from "./organizations.service";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";

@Controller("organizations")
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsService)
    private readonly organizations: OrganizationsService,
  ) {}

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateOrganizationDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.organizations.update(id, dto, authorization);
  }
}

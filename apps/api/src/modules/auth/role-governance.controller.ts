import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";

import { ServiceSession } from "./request-session";
import type { AuthSessionReference } from "./auth.service";
import { AssignRoleDto } from "./dto/assign-role.dto";
import { RevokeGovernanceDto } from "./dto/revoke-governance.dto";
import { RoleGovernanceService } from "./role-governance.service";

@Controller("auth/role-governance")
export class RoleGovernanceController {
  constructor(@Inject(RoleGovernanceService) private readonly governance: RoleGovernanceService) {}

  @Get("memberships")
  list(@ServiceSession() authorization?: AuthSessionReference) {
    return this.governance.list(authorization);
  }

  @Post("roles")
  assign(@Body() dto: AssignRoleDto, @ServiceSession() authorization?: AuthSessionReference) {
    return this.governance.assign(dto, authorization);
  }

  @Post("roles/:id/revoke")
  revokeRole(
    @Param("id") id: string,
    @Body() dto: RevokeGovernanceDto,
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return this.governance.revokeRoleAssignment(id, dto.reason, authorization);
  }

  @Post("memberships/:id/revoke")
  revokeMembership(
    @Param("id") id: string,
    @Body() dto: RevokeGovernanceDto,
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return this.governance.revokeMembership(id, dto.reason, authorization);
  }
}

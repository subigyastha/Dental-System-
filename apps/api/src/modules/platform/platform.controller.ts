import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { CreateSupportAccessGrantDto } from "./dto/create-support-access-grant.dto";
import { RevokeSupportAccessGrantDto } from "./dto/revoke-support-access-grant.dto";
import { UpdateFeatureFlagDto } from "./dto/update-feature-flag.dto";
import { PlatformService } from "./platform.service";

@Controller("platform")
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get("metrics")
  metrics(@ServiceSession() authorization?: AuthSessionReference) { return this.platform.aggregateMetrics(authorization); }

  @Get("features")
  features(@ServiceSession() authorization?: AuthSessionReference) { return this.platform.listFeatureFlags(authorization); }

  @Post("features/:key")
  updateFeature(@Param("key") key: string, @Body() dto: UpdateFeatureFlagDto, @ServiceSession() authorization?: AuthSessionReference) {
    return this.platform.updateFeatureFlag(key, dto, authorization);
  }

  @Post("features/:key/organizations/:organizationId")
  updateOverride(@Param("key") key: string, @Param("organizationId") organizationId: string, @Body() dto: UpdateFeatureFlagDto, @ServiceSession() authorization?: AuthSessionReference) {
    return this.platform.setOrganizationFeatureOverride(key, organizationId, dto, authorization);
  }

  @Get("support-access")
  supportGrants(@ServiceSession() authorization?: AuthSessionReference) { return this.platform.listSupportAccessGrants(authorization); }

  @Post("support-access")
  createGrant(@Body() dto: CreateSupportAccessGrantDto, @ServiceSession() authorization?: AuthSessionReference) {
    return this.platform.createSupportAccessGrant(dto, authorization);
  }

  @Post("support-access/:id/revoke")
  revokeGrant(@Param("id") id: string, @Body() dto: RevokeSupportAccessGrantDto, @ServiceSession() authorization?: AuthSessionReference) {
    return this.platform.revokeSupportAccessGrant(id, dto.reason, authorization);
  }
}

import { Body, Controller, Inject, Param, Patch, Post } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { FollowupsService } from "./followups.service";
import { UpdateFollowupDto } from "./update-followup.dto";

@Controller("followups")
export class FollowupsController {
  constructor(
    @Inject(FollowupsService)
    private readonly followups: FollowupsService,
  ) {}

  @Post("clients/:id/recall")
  createRecall(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.followups.createRecall(id, authorization);
  }

  @Patch(":id")
  close(@Param("id") id: string, @Body() dto: UpdateFollowupDto, @ServiceSession() authorization?: string) {
    return this.followups.update(id, dto, authorization);
  }
}

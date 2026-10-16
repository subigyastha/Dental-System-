import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { FollowupsService } from "./followups.service";
import { UpdateFollowupDto } from "./update-followup.dto";
import { CreateProcedureReviewDto } from "./create-procedure-review.dto";
import { FollowupHistoryDto, FollowupQueueDto, LogFollowupDto } from "./followup-work.dto";
import { StaffFollowupsService } from "./staff-followups.service";
import { FollowupClientsDto, StaffFollowupDto } from "./staff-followup.dto";

@Controller("followups")
export class FollowupsController {
  constructor(
    @Inject(FollowupsService)
    private readonly followups: FollowupsService,
    @Inject(StaffFollowupsService) private readonly staffFollowups: StaffFollowupsService,
  ) {}

  @Get()
  list(@Query() query: FollowupQueueDto, @ServiceSession() authorization?: string) {
    return this.followups.list(query, authorization);
  }

  @Get("clients")
  clients(@Query() query: FollowupClientsDto, @ServiceSession() authorization?: string) {
    return this.staffFollowups.clients(query, authorization);
  }

  @Post("clients/:id/actions")
  save(@Param("id") id: string, @Body() dto: StaffFollowupDto, @ServiceSession() authorization?: string) {
    return this.staffFollowups.save(id, dto, authorization);
  }

  @Get(":id")
  get(@Param("id") id: string, @Query() query: FollowupHistoryDto, @ServiceSession() authorization?: string) {
    return this.followups.get(id, authorization, query.cursor);
  }

  @Post(":id/responses")
  log(@Param("id") id: string, @Body() dto: LogFollowupDto, @ServiceSession() authorization?: string) {
    return this.followups.log(id, dto, authorization);
  }

  @Post("clients/:id/recall")
  createRecall(@Param("id") id: string, @Body() dto: StaffFollowupDto, @ServiceSession() authorization?: string) {
    return this.staffFollowups.save(id, { ...dto, action: "schedule" }, authorization);
  }

  @Patch(":id")
  close(@Param("id") id: string, @Body() dto: UpdateFollowupDto, @ServiceSession() authorization?: string) {
    return this.followups.update(id, dto, authorization);
  }

  @Post("clients/:id/procedure-review")
  createProcedureReview(@Param("id") id: string, @Body() dto: CreateProcedureReviewDto, @ServiceSession() authorization?: string) {
    return this.followups.createProcedureReview(id, dto, authorization);
  }
}

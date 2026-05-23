import { Controller, Inject, Param, Patch } from "@nestjs/common";

import { FollowupsService } from "./followups.service";

@Controller("followups")
export class FollowupsController {
  constructor(
    @Inject(FollowupsService)
    private readonly followups: FollowupsService,
  ) {}

  @Patch(":id")
  close(@Param("id") id: string) {
    return this.followups.close(id);
  }
}

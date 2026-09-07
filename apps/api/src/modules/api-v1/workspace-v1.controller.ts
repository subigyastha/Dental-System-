import { Controller, Get, Inject, Req, UseFilters } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";
import { WorkspaceBootstrapService } from "./workspace-bootstrap.service";

@Controller("v1/workspace")
@UseFilters(V1ExceptionFilter)
export class WorkspaceV1Controller {
  constructor(@Inject(WorkspaceBootstrapService) private readonly workspace: WorkspaceBootstrapService) {}

  @Get("bootstrap")
  async bootstrap(
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.workspace.getBootstrap(authorization), request.requestId);
  }
}

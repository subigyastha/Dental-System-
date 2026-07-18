import { Body, Controller, Inject, Post } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { CommunicationsService } from "./communications.service";
import { CreateCommunicationDto } from "./dto/create-communication.dto";

@Controller("communications")
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCommunicationDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.communications.create(dto, authorization);
  }
}

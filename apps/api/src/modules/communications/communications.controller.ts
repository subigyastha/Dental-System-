import { Body, Controller, Headers, Inject, Post } from "@nestjs/common";

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
    @Headers("authorization") authorization?: string,
  ) {
    return this.communications.create(dto, authorization);
  }
}

import { Body, Controller, Inject, Post } from "@nestjs/common";

import { CommunicationsService } from "./communications.service";
import { CreateCommunicationDto } from "./dto/create-communication.dto";

@Controller("communications")
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
  ) {}

  @Post()
  create(@Body() dto: CreateCommunicationDto) {
    return this.communications.create(dto);
  }
}

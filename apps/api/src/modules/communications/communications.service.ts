import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { CreateCommunicationDto } from "./dto/create-communication.dto";

@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(dto: CreateCommunicationDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      select: { organizationId: true },
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    await this.prisma.$transaction([
      this.prisma.communicationLog.create({
        data: {
          organizationId: appointment.organizationId,
          appointmentId: dto.appointmentId,
          customerId: dto.customerId,
          channel: dto.channel,
          direction: dto.direction,
          summary: dto.summary,
        },
      }),
      this.prisma.appointment.update({
        where: { id: dto.appointmentId },
        data: { communicationState: "Confirmed by phone" },
      }),
    ]);

    return { ok: true };
  }
}

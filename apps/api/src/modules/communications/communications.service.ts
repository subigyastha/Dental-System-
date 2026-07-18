import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCommunicationDto } from "./dto/create-communication.dto";

@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async create(dto: CreateCommunicationDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session.role);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: dto.appointmentId, organizationId: session.organizationId },
      select: { organizationId: true, customerId: true },
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    if (dto.customerId !== appointment.customerId) {
      throw new BadRequestException("Communication customer must match the appointment");
    }

    await this.prisma.$transaction([
      this.prisma.communicationLog.create({
        data: {
          organizationId: appointment.organizationId,
          appointmentId: dto.appointmentId,
          customerId: appointment.customerId,
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

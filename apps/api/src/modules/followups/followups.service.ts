import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FollowupsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async close(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const task = await this.prisma.followUpTask.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException("Follow-up task not found");
    }

    await this.prisma.followUpTask.update({
      where: { id: task.id },
      data: { status: "Done" },
    });

    return { ok: true };
  }
}

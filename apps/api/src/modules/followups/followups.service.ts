import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FollowupsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async close(id: string) {
    await this.prisma.followUpTask.update({
      where: { id },
      data: { status: "Done" },
    });

    return { ok: true };
  }
}

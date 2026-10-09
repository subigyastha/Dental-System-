import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateFollowupDto } from "./update-followup.dto";
import { Prisma } from "@prisma/client";
import { defaultRecallDate, recurringRecallAction, routineRecallAction } from "./recall-date";
import { assertFollowupActor } from "./followup-access";

@Injectable()
export class FollowupsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async createRecall(customerId: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} AND "organizationId" = ${session.organizationId} FOR UPDATE`);
      const customer = await tx.customer.findFirst({ where: { id: customerId, organizationId: session.organizationId, archivedAt: null, mergedIntoCustomerId: null }, select: { id: true } });
      if (!customer) throw new NotFoundException("Active client not found");
      const appointment = await tx.appointment.findFirst({
        where: { customerId, organizationId: session.organizationId, status: "Completed" },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        select: { id: true, providerId: true, locationId: true, startsAt: true },
      });
      if (!appointment) throw new NotFoundException("No completed visit is available for recall review");
      assertFollowupActor(session, { appointment, ownerId: appointment.providerId });
      const existing = await tx.followUpTask.findFirst({
        where: { organizationId: session.organizationId, customerId, type: "Recall", status: { not: "Done" } },
        select: { id: true, ownerId: true, appointment: { select: { locationId: true, providerId: true } } },
      });
      if (existing) {
        assertFollowupActor(session, existing);
        return { id: existing.id };
      }
      const task = await tx.followUpTask.create({ data: {
        organizationId: session.organizationId, customerId, appointmentId: appointment.id,
        ownerId: appointment.providerId, type: "Recall", status: "Open", priority: "Normal",
        dueAt: defaultRecallDate(appointment.startsAt), summary: "Six-month dental recall",
        nextAction: routineRecallAction,
      } });
      await tx.auditLog.create({ data: {
        organizationId: session.organizationId, actorId: session.id, entityType: "follow_up",
        entityId: task.id, action: "recall_created", newValue: { appointmentId: appointment.id, dueAtIso: task.dueAt.toISOString() },
        description: "Staff created a recall from the latest completed visit",
      } });
      return { id: task.id };
    });
  }

  async close(id: string, authorization?: string) {
    return this.update(id, { status: "Done", outcome: "Follow-up completed" }, authorization);
  }

  async update(id: string, dto: UpdateFollowupDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const task = await this.prisma.followUpTask.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true, customerId: true, appointmentId: true, type: true, status: true, dueAt: true, nextAction: true, updatedAt: true, ownerId: true, appointment: { select: { locationId: true, providerId: true } } },
    });

    if (!task) {
      throw new NotFoundException("Follow-up task not found");
    }

    assertFollowupActor(session, task);
    if (!["Done", "Open"].includes(dto.status) || !dto.outcome?.trim()) {
      throw new BadRequestException("Record the call outcome or reason for changing this follow-up");
    }
    const dueAt = dto.dueAtIso ? new Date(dto.dueAtIso) : task.dueAt;
    if (!dueAt || Number.isNaN(dueAt.getTime())) throw new BadRequestException("Choose a valid follow-up date");
    if (dto.status === "Open" && !dto.dueAtIso) throw new BadRequestException("Choose the next follow-up date");
    if (dto.status === "Done" && task.status === "Done") return { ok: true };
    if (task.status === "Done") throw new BadRequestException("Completed follow-ups cannot be reopened. Update the next recall instead.");
    const nextRecallAt = dto.dueAtIso ? dueAt : defaultRecallDate(new Date());
    if (dto.status === "Done" && task.type === "Recall" && nextRecallAt <= new Date()) {
      throw new BadRequestException("The next routine recall must be in the future");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${task.customerId} AND "organizationId" = ${session.organizationId} FOR UPDATE`);
      // A repeated successful call outcome must not create another next recall.
      if (dto.status === "Done" && await tx.followUpTask.findFirst({ where: { id: task.id, organizationId: session.organizationId, status: "Done" }, select: { id: true } })) return;
      const changed = await tx.followUpTask.updateMany({
        where: { id: task.id, organizationId: session.organizationId, updatedAt: task.updatedAt },
        data: { status: dto.status, dueAt: dto.status === "Done" ? task.dueAt : dueAt, nextAction: dto.outcome.trim() },
      });
      if (changed.count !== 1) throw new ConflictException("This follow-up has changed. Refresh and try again.");
      await tx.auditLog.create({ data: {
        organizationId: session.organizationId, actorId: session.id,
        entityType: "follow_up", entityId: task.id,
        action: dto.status === "Done" ? "completed" : "rescheduled",
        oldValue: { status: task.status, dueAtIso: task.dueAt.toISOString(), nextAction: task.nextAction },
        newValue: { status: dto.status, dueAtIso: (dto.status === "Done" ? task.dueAt : dueAt).toISOString(), outcome: dto.outcome.trim(), ...(dto.status === "Done" && task.type === "Recall" ? { nextRecallAtIso: nextRecallAt.toISOString() } : {}) },
        description: dto.outcome.trim(),
      } });
      if (dto.status === "Done" && task.type === "Recall") {
        const next = await tx.followUpTask.findFirst({
          where: { organizationId: session.organizationId, customerId: task.customerId, type: "Recall", status: { not: "Done" } },
          select: { id: true },
        });
        if (!next) await tx.followUpTask.create({ data: {
          organizationId: session.organizationId, customerId: task.customerId, appointmentId: task.appointmentId,
          ownerId: task.ownerId, type: "Recall", status: "Open", priority: "Normal", dueAt: nextRecallAt,
          summary: "Six-month dental recall", nextAction: dto.dueAtIso ? "Call the client for their next routine recall on the agreed date." : recurringRecallAction,
        } });
      }
    });

    return { ok: true };
  }
}

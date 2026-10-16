import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateFollowupDto } from "./update-followup.dto";
import { Prisma } from "@prisma/client";
import { assertFollowupActor, canManageFollowup, followupLocationScope } from "./followup-access";
import { CreateProcedureReviewDto } from "./create-procedure-review.dto";
import { adDateKeyInTimeZone, isValidAdDateKey } from "../scheduling/ad-date-key";
import { FollowupQueueDto, LogFollowupDto, responseLabels } from "./followup-work.dto";

const taskSelect = {
  id: true, customerId: true, appointmentId: true, ownerId: true, type: true,
  status: true, dueAt: true, dateOnly: true, summary: true, nextAction: true, updatedAt: true,
  customer: { select: { fullName: true, phone: true, patientCode: true, archivedAt: true, mergedIntoCustomerId: true } },
  appointment: { select: { startsAt: true, locationId: true, providerId: true, customProcedureName: true, provider: { select: { displayName: true } }, services: { select: { service: { select: { name: true } } }, take: 20 } } },
} satisfies Prisma.FollowUpTaskSelect;
type WorkTask = Prisma.FollowUpTaskGetPayload<{ select: typeof taskSelect }>;

function workTask(task: WorkTask, canManage: boolean) {
  return { id: task.id, customerId: task.customerId, appointmentId: task.appointmentId,
    type: task.type, status: task.status, dueAtIso: task.dueAt.toISOString(), dateOnly: task.dateOnly,
    updatedAtIso: task.updatedAt.toISOString(), summary: task.summary, nextAction: task.nextAction,
    client: { name: task.customer.fullName, phone: task.customer.phone, code: task.customer.patientCode },
    visit: task.appointment ? { startsAtIso: task.appointment.startsAt.toISOString(),
      label: task.appointment.customProcedureName || task.appointment.services?.map(item => item.service.name).join(", ") || null, locationId: task.appointment.locationId,
      provider: task.appointment.provider.displayName, providerId: task.appointment.providerId } : null,
    canManage: canManage && !task.customer.archivedAt && !task.customer.mergedIntoCustomerId };
}

function responseValue(value: Prisma.JsonValue | null, description: string | null) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { label: typeof data.response === "string" && Object.hasOwn(responseLabels, data.response)
    ? responseLabels[data.response as keyof typeof responseLabels] : typeof data.outcome === "string" ? data.outcome : description ?? "Follow-up updated",
    note: typeof data.note === "string" ? data.note : null,
    response: typeof data.response === "string" && Object.hasOwn(responseLabels, data.response) ? data.response : null,
    nextContactAtIso: typeof data.nextContactAtIso === "string" ? data.nextContactAtIso : null };
}

const responseActions = ["response_logged", "completed", "rescheduled"];

@Injectable()
export class FollowupsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async list(query: FollowupQueueDto, authorization?: string) {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    const now = new Date();
    const today = new Date(adDateKeyInTimeZone(now) + "T00:00:00+05:45");
    const tomorrow = new Date(today.getTime() + 86400000);
    const base: Prisma.FollowUpTaskWhereInput = {
      organizationId: actor.organizationId, ...followupLocationScope(actor),
      customer: { archivedAt: null, mergedIntoCustomerId: null },
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.period ? { dueAt: query.period === "today" ? { gte: today, lt: tomorrow }
        : query.period === "overdue" ? { lt: today } : { gte: tomorrow } } : {}),
      ...(query.purpose === "post_visit" ? { type: "TreatmentContinuation" } : {}),
      ...(query.query?.trim() ? { OR: [
        { customer: { fullName: { contains: query.query.trim(), mode: "insensitive" } } },
        { customer: { phone: { contains: query.query.trim() } } },
        { summary: { contains: query.query.trim(), mode: "insensitive" } },
      ] } : {}),
    };
    const views: Record<string, Prisma.FollowUpTaskWhereInput> = {
      attention: { status: { not: "Done" }, dueAt: { lte: now } },
      upcoming: { status: { not: "Done" }, dueAt: { gt: now } },
      done: { status: "Done" },
      today: { status: { not: "Done" }, dueAt: { gte: today, lt: tomorrow } },
      overdue: { status: { not: "Done" }, dueAt: { lt: today } },
      future: { status: { not: "Done" }, dueAt: { gte: tomorrow } },
    };
    const where = { AND: [base, query.view === "all" ? {} : views[query.view ?? "attention"]] };
    const direction = query.direction ?? (query.view === "done" && !query.sort ? "desc" : "asc");
    const sort = query.sort ?? (query.view === "done" ? "updated" : "due");
    const order: Prisma.FollowUpTaskOrderByWithRelationInput = sort === "client" ? { customer: { fullName: direction } }
      : sort === "status" ? { status: direction } : sort === "updated" ? { updatedAt: direction } : { dueAt: direction };
    const statuses = ["Open", "InProgress", "Waiting", "Blocked", "Done"] as const;
    if (query.cursor && !await this.prisma.followUpTask.findFirst({ where: { AND: [where, { id: query.cursor }] }, select: { id: true } })) {
      throw new ConflictException("The queue has changed. Refresh the list.");
    }
    const [tasks, viewCounts, statusGroups] = await Promise.all([
      this.prisma.followUpTask.findMany({ where, select: taskSelect, take: 26,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [order, { id: direction }],
      }),
      Promise.all(Object.values(views).map(view => this.prisma.followUpTask.count({ where: { AND: [base, view] } }))),
      this.prisma.followUpTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    const [attention, upcoming, done, todayCount, overdue, future] = viewCounts;
    const statusTotals = statuses.map(status => statusGroups.find(group => group.status === status)?._count._all ?? 0);
    const page = tasks.slice(0, 25);
    // One bounded page; DISTINCT ON returns only the latest response per task.
    const responses = page.length ? await this.prisma.$queryRaw<Array<{ entityId: string; newValue: Prisma.JsonValue; description: string | null; createdAt: Date }>>(Prisma.sql`
      SELECT DISTINCT ON ("entityId") "entityId", "newValue", "description", "createdAt"
      FROM "AuditLog" WHERE "organizationId" = ${actor.organizationId} AND "entityType" = 'follow_up'
      AND "entityId" IN (${Prisma.join(page.map(task => task.id))})
      AND "action" IN (${Prisma.join(responseActions)})
      ORDER BY "entityId", "createdAt" DESC, "id" DESC
    `) : [];
    const latest = new Map(responses.map(row => [row.entityId, { ...responseValue(row.newValue, row.description), atIso: row.createdAt.toISOString() }]));
    return { items: page.map(task => ({ ...workTask(task, canManageFollowup(actor, task)), lastResponse: latest.get(task.id) ?? null })),
      counts: { attention, upcoming, done, today: todayCount, overdue, future },
      statusCounts: Object.fromEntries(statuses.map((status, index) => [status, statusTotals[index]])),
      total: statusTotals.reduce((sum, count) => sum + count, 0),
      page: { hasMore: tasks.length > 25, nextCursor: tasks.length > 25 ? page.at(-1)!.id : null } };
  }

  async get(id: string, authorization?: string, historyCursor?: string) {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    const task = await this.prisma.followUpTask.findFirst({ where: { id, organizationId: actor.organizationId, ...followupLocationScope(actor) }, select: taskSelect });
    if (!task) throw new NotFoundException("Follow-up task not found");
    const historyWhere = { organizationId: actor.organizationId, entityType: "follow_up", entityId: id, action: { in: responseActions } };
    if (historyCursor && !await this.prisma.auditLog.findFirst({ where: { ...historyWhere, id: historyCursor }, select: { id: true } })) throw new NotFoundException("Response history page not found");
    const history = await this.prisma.auditLog.findMany({
      where: historyWhere,
      ...(historyCursor ? { cursor: { id: historyCursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
      select: { id: true, newValue: true, description: true, createdAt: true, actor: { select: { name: true } } },
    });
    return { task: workTask(task, canManageFollowup(actor, task)), history: history.slice(0, 50).map(row => ({
      id: row.id, ...responseValue(row.newValue, row.description), atIso: row.createdAt.toISOString(), actor: row.actor?.name ?? "Former staff",
    })), hasOlderHistory: history.length > 50, nextHistoryCursor: history.length > 50 ? history[49].id : null };
  }

  async log(id: string, dto: LogFollowupDto, authorization?: string) {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    if (!Object.hasOwn(responseLabels, dto.response) || !dto.requestId?.trim()) throw new BadRequestException("Choose a response");
    const note = dto.note?.trim() || null;
    if (["provider_attention", "not_needed"].includes(dto.response) && !note) throw new BadRequestException("Enter a brief reason");
    const initial = await this.prisma.followUpTask.findFirst({ where: { id, organizationId: actor.organizationId }, select: { customerId: true, ownerId: true, appointment: { select: { providerId: true, locationId: true } } } });
    if (!initial) throw new NotFoundException("Follow-up task not found");
    assertFollowupActor(actor, initial);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${initial.customerId} AND "organizationId" = ${actor.organizationId} FOR UPDATE`);
      const task = await tx.followUpTask.findFirst({ where: { id, organizationId: actor.organizationId }, select: taskSelect });
      if (!task) throw new NotFoundException("Follow-up task not found");
      assertFollowupActor(actor, task);
      const replay = await tx.auditLog.findFirst({ where: { organizationId: actor.organizationId, entityType: "follow_up", entityId: id, action: "response_logged", newValue: { path: ["requestId"], equals: dto.requestId } }, select: { newValue: true } });
      if (replay) {
        const original = replay.newValue as Prisma.JsonObject;
        if (original.response !== dto.response || original.note !== note || original.requestedNextContactAtIso !== (dto.nextContactAtIso ?? null) || original.requestedNextRecallAtIso !== (dto.nextRecallAtIso ?? null)) throw new ConflictException("This request was already saved with different details. Refresh the follow-up.");
        return { ok: true };
      }
      if (task.customer.archivedAt || task.customer.mergedIntoCustomerId) throw new BadRequestException("Open the active client record before logging a response");
      if (task.status === "Done") throw new ConflictException("This follow-up is finished. Its history cannot be changed.");
      if (task.updatedAt.toISOString() !== dto.expectedUpdatedAtIso) throw new ConflictException("This follow-up has changed. Refresh and check the latest response.");
      const now = new Date();
      const waiting = ["no_answer", "contact_later", "reschedule"].includes(dto.response);
      const nextContactAt = dto.nextContactAtIso ? new Date(dto.nextContactAtIso) : null;
      if (waiting && (!nextContactAt || Number.isNaN(nextContactAt.getTime()) || nextContactAt <= now)) throw new BadRequestException("Choose a future contact date and time, including for later today");
      const finished = ["reached", "not_needed"].includes(dto.response);
      if (dto.nextRecallAtIso) throw new BadRequestException("Schedule the next follow-up separately");
      const status = finished ? "Done" : waiting ? "Waiting" : dto.response === "provider_attention" ? "Blocked" : "Open";
      const dueAt = finished ? task.dueAt : waiting ? nextContactAt! : now;
      const nextAction = waiting ? "Contact the client at the agreed time." : dto.response === "provider_attention"
        ? `Ask ${task.appointment?.provider.displayName ?? "the treating provider"} to review: ${note}`
        : dto.response === "appointment_needed" ? "Arrange an appointment, then log the result." : responseLabels[dto.response];
      const changed = await tx.followUpTask.updateMany({ where: { id, organizationId: actor.organizationId, updatedAt: task.updatedAt }, data: {
        status, dueAt, ...(finished ? {} : { dateOnly: false }), nextAction, updatedAt: new Date(Math.max(now.getTime(), task.updatedAt.getTime() + 1)),
      } });
      if (changed.count !== 1) throw new ConflictException("This follow-up has changed. Refresh before saving.");
      const contact = ["reached", "no_answer", "contact_later", "appointment_needed", "provider_attention"].includes(dto.response)
        ? await tx.communicationLog.create({ data: {
          organizationId: actor.organizationId, customerId: task.customerId, appointmentId: task.appointmentId, followUpTaskId: id,
          purpose: "follow_up", source: "manual", channel: "unknown", direction: "unknown",
          result: dto.response === "no_answer" ? "no_answer" : "reached", summary: responseLabels[dto.response],
          occurredAt: now, recordedAt: now, recordedByUserId: actor.id, requestId: dto.requestId,
          // Legacy notes mix staff instructions and feedback; retain their meaning
          // without relabelling every note as something the client said.
          metadata: { legacyResponse: dto.response, staffNote: note },
        }, select: { id: true } }) : null;
      await tx.auditLog.create({ data: { organizationId: actor.organizationId, actorId: actor.id, entityType: "follow_up", entityId: id,
        action: "response_logged", description: responseLabels[dto.response],
        oldValue: { status: task.status, dueAtIso: task.dueAt.toISOString(), nextAction: task.nextAction },
        newValue: { requestId: dto.requestId, response: dto.response, note, status, communicationId: contact?.id ?? null, nextContactAtIso: waiting ? dueAt.toISOString() : null,
          requestedNextContactAtIso: dto.nextContactAtIso ?? null, requestedNextRecallAtIso: dto.nextRecallAtIso ?? null },
      } });
      return { ok: true };
    });
  }

  async createProcedureReview(customerId: string, dto: CreateProcedureReviewDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    if (!isValidAdDateKey(dto.dueDate) || !dto.summary?.trim() || !dto.nextAction?.trim()) {
      throw new BadRequestException("Choose a valid review date and enter the procedure and next action");
    }
    const dueAt = new Date(dto.dueDate + "T00:00:00+05:45");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} AND "organizationId" = ${session.organizationId} FOR UPDATE`);
      const customer = await tx.customer.findFirst({ where: { id: customerId, organizationId: session.organizationId, archivedAt: null, mergedIntoCustomerId: null }, select: { id: true } });
      if (!customer) throw new NotFoundException("Active client not found");
      const appointment = await tx.appointment.findFirst({
        where: { id: dto.appointmentId, customerId, organizationId: session.organizationId, status: "Completed" },
        select: { id: true, providerId: true, locationId: true, startsAt: true },
      });
      if (!appointment) throw new NotFoundException("Completed visit not found");
      assertFollowupActor(session, { appointment, ownerId: appointment.providerId });
      if (dto.dueDate < adDateKeyInTimeZone(appointment.startsAt)) {
        throw new BadRequestException("The review date cannot be before the completed visit");
      }
      const existing = await tx.followUpTask.findFirst({
        where: { organizationId: session.organizationId, customerId, appointmentId: appointment.id, type: "TreatmentContinuation", status: { not: "Done" } },
        select: { id: true, dueAt: true, summary: true, nextAction: true },
      });
      if (existing) {
        if (existing.dueAt.getTime() === dueAt.getTime() && existing.summary === dto.summary.trim() && existing.nextAction === dto.nextAction.trim()) return { id: existing.id };
        throw new ConflictException("This visit already has an open procedure follow-up. Update that task instead.");
      }
      const task = await tx.followUpTask.create({ data: {
        organizationId: session.organizationId, customerId, appointmentId: appointment.id,
        ownerId: appointment.providerId, type: "TreatmentContinuation", status: "Open", priority: "Normal",
        dueAt, dateOnly: true, summary: dto.summary.trim(), nextAction: dto.nextAction.trim(),
      } });
      await tx.auditLog.create({ data: {
        organizationId: session.organizationId, actorId: session.id, entityType: "follow_up",
        entityId: task.id, action: "procedure_review_created",
        newValue: { appointmentId: appointment.id, dueAtIso: dueAt.toISOString() },
        description: "Staff scheduled a procedure follow-up",
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
    if (task.status === "Done") throw new BadRequestException("Completed follow-ups cannot be reopened. Schedule another follow-up separately.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${task.customerId} AND "organizationId" = ${session.organizationId} FOR UPDATE`);
      // A repeated successful call outcome must not create another next recall.
      if (dto.status === "Done" && await tx.followUpTask.findFirst({ where: { id: task.id, organizationId: session.organizationId, status: "Done" }, select: { id: true } })) return;
      const changed = await tx.followUpTask.updateMany({
        where: { id: task.id, organizationId: session.organizationId, updatedAt: task.updatedAt },
        data: { status: dto.status, dueAt: dto.status === "Done" ? task.dueAt : dueAt, ...(dto.status === "Open" ? { dateOnly: false } : {}), nextAction: dto.outcome.trim() },
      });
      if (changed.count !== 1) throw new ConflictException("This follow-up has changed. Refresh and try again.");
      await tx.auditLog.create({ data: {
        organizationId: session.organizationId, actorId: session.id,
        entityType: "follow_up", entityId: task.id,
        action: dto.status === "Done" ? "completed" : "rescheduled",
        oldValue: { status: task.status, dueAtIso: task.dueAt.toISOString(), nextAction: task.nextAction },
        newValue: { status: dto.status, dueAtIso: (dto.status === "Done" ? task.dueAt : dueAt).toISOString(), outcome: dto.outcome.trim() },
        description: dto.outcome.trim(),
      } });
    });

    return { ok: true };
  }
}

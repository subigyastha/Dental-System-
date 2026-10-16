import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService, type AuthSession } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { assertFollowupActor, canManageFollowup, recallAppointmentLocationScope } from "./followup-access";
import { FollowupClientsDto, StaffFollowupDto } from "./staff-followup.dto";
import { adDateKeyInTimeZone } from "../scheduling/ad-date-key";

const visitSelect = { id: true, startsAt: true, providerId: true, locationId: true, customProcedureName: true,
  provider: { select: { displayName: true } }, services: { take: 20, select: { service: { select: { name: true } } } } } satisfies Prisma.AppointmentSelect;

function contactEvents(organizationId: string) {
  return Prisma.sql`
    SELECT c."customerId", c."appointmentId", c."occurredAt", c."result" FROM "CommunicationLog" c
    WHERE c."organizationId" = ${organizationId} AND c."purpose" = 'follow_up' AND c."result" IN ('reached','no_answer')
    UNION ALL
    SELECT COALESCE(t."customerId",l."entityId"), COALESCE(t."appointmentId",l."newValue"->>'appointmentId'), l."createdAt", COALESCE(l."newValue"->>'result',l."newValue"->>'response')
    FROM "AuditLog" l LEFT JOIN "FollowUpTask" t ON l."entityType" = 'follow_up' AND t."id" = l."entityId" AND t."organizationId" = l."organizationId"
    WHERE l."organizationId" = ${organizationId} AND l."newValue"->>'communicationId' IS NULL
      AND NOT EXISTS (SELECT 1 FROM "CommunicationLog" migrated WHERE migrated."organizationId" = l."organizationId" AND migrated."metadata"->>'auditLogId' = l."id")
      AND ((l."entityType" = 'client_contact' AND l."action" = 'contact_logged') OR (l."entityType" = 'follow_up' AND l."action" = 'response_logged' AND l."newValue"->>'response' IN ('reached','no_answer','contact_later','appointment_needed','provider_attention')))
  `;
}

@Injectable()
export class StaffFollowupsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService) {}

  private async context(tx: Prisma.TransactionClient, actor: AuthSession, customerId: string, appointmentId?: string, existingTask = false) {
    const client = await tx.customer.findFirst({ where: { id: customerId, organizationId: actor.organizationId, archivedAt: null, mergedIntoCustomerId: null }, select: { id: true } });
    if (!client) throw new NotFoundException("Active client not found");
    const visit = await tx.appointment.findFirst({ where: { organizationId: actor.organizationId, customerId,
      ...recallAppointmentLocationScope(actor), ...(appointmentId ? { id: appointmentId, ...(existingTask ? {} : { status: "Completed" as const }) } : { status: "Completed", startsAt: { lte: new Date() } }) },
      select: visitSelect, orderBy: [{ startsAt: "desc" }, { id: "desc" }] });
    if (appointmentId && !visit) throw new NotFoundException("Completed visit not found");
    assertFollowupActor(actor, { appointment: visit, ownerId: visit?.providerId ?? null });
    return visit;
  }

  async save(customerId: string, dto: StaffFollowupDto, authorization?: string) {
    const actor = await this.auth.requireSession(authorization); assertClinicOperator(actor);
    if (!["log", "schedule"].includes(dto.action)) throw new BadRequestException("Choose log or schedule");
    if (!dto.requestId?.trim()) throw new BadRequestException("A save reference is required");
    if (dto.action === "log" && !["reached", "no_answer"].includes(dto.result ?? "")) throw new BadRequestException("Choose whether you spoke to the client");
    const due = dto.dueAtIso ? new Date(dto.dueAtIso) : null;
    if (dto.action === "schedule" && (!due || Number.isNaN(due.getTime()))) throw new BadRequestException("Choose a valid follow-up date");
    if (dto.action === "log" && (dto.dueAtIso || dto.reason)) throw new BadRequestException("Schedule the next contact separately");
    if (dto.action === "schedule" && dto.result) throw new BadRequestException("Scheduling is not a contact attempt");
    if (dto.channel && !["call", "whatsapp", "sms", "email", "in_person", "other", "unknown"].includes(dto.channel)) throw new BadRequestException("Choose a supported contact method");
    if (dto.direction && !["inbound", "outbound"].includes(dto.direction)) throw new BadRequestException("Choose inbound or outbound contact");
    if (dto.action === "schedule" && (dto.channel || dto.direction || dto.responseText || dto.occurredAtIso)) throw new BadRequestException("Record actual contact details when logging a follow-up");
    if (dto.action === "log" && dto.dateOnly !== undefined) throw new BadRequestException("Date-only precision belongs to a scheduled reminder");
    const occurredAt = dto.occurredAtIso ? new Date(dto.occurredAtIso) : null;
    if (occurredAt && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(dto.occurredAtIso!) || Number.isNaN(occurredAt.getTime()) || occurredAt > new Date())) throw new BadRequestException("Contact time must include a timezone and be a valid past or current time");
    if ((dto.responseText?.trim().length ?? 0) > 2000) throw new BadRequestException("Keep the response within 2000 characters");
    if (dto.result === "no_answer" && dto.responseText?.trim()) throw new BadRequestException("An unanswered attempt cannot contain a client response");
    const payload = { action: dto.action, appointmentId: dto.appointmentId ?? null, taskId: dto.taskId ?? null,
      result: dto.result ?? null, dueAtIso: dto.dueAtIso ?? null, dateOnly: dto.dateOnly ?? false, reason: dto.reason?.trim() || null,
      channel: dto.action === "log" ? dto.channel ?? "unknown" : null, direction: dto.action === "log" ? dto.direction ?? "outbound" : null,
      responseText: dto.responseText?.trim() || null, occurredAtIso: occurredAt?.toISOString() ?? null };
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} AND "organizationId" = ${actor.organizationId} FOR UPDATE`);
      const visit = await this.context(tx, actor, customerId, dto.appointmentId, Boolean(dto.taskId));
      const replay = await tx.auditLog.findFirst({ where: { organizationId: actor.organizationId, entityType: "client_contact", entityId: customerId,
        newValue: { path: ["requestId"], equals: dto.requestId } }, select: { newValue: true } });
      if (replay) {
        const saved = replay.newValue as Prisma.JsonObject;
        if (JSON.stringify(saved.payload) !== JSON.stringify(payload)) {
          // JSONB object key order is not stable; compare the actual fields.
          const original = saved.payload as Prisma.JsonObject;
          const legacyDefaults: Prisma.JsonObject = { channel: dto.action === "log" ? "unknown" : null, direction: dto.action === "log" ? "outbound" : null };
          if (!original || Object.entries(payload).some(([key, value]) => (original[key] ?? legacyDefaults[key] ?? null) !== value)) throw new ConflictException("This save reference was already used with different details");
        }
        return { ok: true };
      }
      const now = new Date();
      if (dto.action === "schedule" && (dto.dateOnly ? adDateKeyInTimeZone(due!) < adDateKeyInTimeZone(now) || due!.toISOString() !== new Date(adDateKeyInTimeZone(due!) + "T00:00:00+05:45").toISOString() : due! <= now)) throw new BadRequestException("Choose today or a future date; a specific time must be in the future");
      let taskId = dto.taskId ?? null;
      let contactAppointmentId = visit?.id ?? null;
      if (taskId) {
        const task = await tx.followUpTask.findFirst({ where: { id: taskId, customerId, organizationId: actor.organizationId },
          select: { id: true, status: true, nextAction: true, updatedAt: true, ownerId: true, appointmentId: true, appointment: { select: { providerId: true, locationId: true } } } });
        if (!task) throw new NotFoundException("Follow-up not found");
        assertFollowupActor(actor, task);
        contactAppointmentId = task.appointmentId;
        if (dto.appointmentId && task.appointmentId !== dto.appointmentId) throw new BadRequestException("This reminder belongs to a different visit");
        if (task.status === "Done" || task.updatedAt.toISOString() !== dto.expectedUpdatedAtIso) throw new ConflictException("This reminder has changed. Close and reopen it before saving");
        const changed = await tx.followUpTask.updateMany({ where: { id: taskId, organizationId: actor.organizationId, updatedAt: task.updatedAt }, data: {
          status: dto.action === "schedule" ? "Open" : dto.result === "reached" && task.status !== "Blocked" ? "Done" : task.status,
          ...(dto.action === "schedule" ? { dueAt: due!, dateOnly: dto.dateOnly ?? false, nextAction: payload.reason || task.nextAction } : {}),
          updatedAt: new Date(Math.max(now.getTime(), task.updatedAt.getTime() + 1)),
        } });
        if (changed.count !== 1) throw new ConflictException("This reminder has changed. Refresh before saving");
      } else if (dto.action === "schedule") {
        const created = await tx.followUpTask.create({ data: { organizationId: actor.organizationId, customerId, appointmentId: visit?.id ?? null,
          ownerId: visit?.providerId ?? null, type: visit ? "TreatmentContinuation" : "Reminder", status: "Open", priority: "Normal", dueAt: due!, dateOnly: dto.dateOnly ?? false,
          summary: visit ? `Check-in: ${visit.customProcedureName || visit.services.map(item => item.service.name).join(", ") || "completed visit"}` : "Client check-in",
          nextAction: payload.reason || "Check in with the client." } }); taskId = created.id;
      }
      const contact = dto.action === "log" ? await tx.communicationLog.create({ data: {
        organizationId: actor.organizationId, customerId, appointmentId: contactAppointmentId, followUpTaskId: taskId,
        purpose: "follow_up", source: "manual", channel: payload.channel!, direction: payload.direction!, result: dto.result!, responseText: payload.responseText,
        summary: dto.result === "reached" ? "Spoke to client" : "No answer", occurredAt: occurredAt ?? now, recordedAt: now,
        recordedByUserId: actor.id, requestId: dto.requestId,
      }, select: { id: true } }) : null;
      if (dto.taskId) await tx.auditLog.create({ data: { organizationId: actor.organizationId, actorId: actor.id, entityType: "follow_up", entityId: taskId!,
        action: dto.action === "schedule" ? "rescheduled" : "response_logged", description: dto.action === "schedule" ? "Staff changed the follow-up date" : dto.result === "reached" ? "Spoke to client" : "No answer",
        newValue: { response: dto.action === "schedule" ? "reschedule" : dto.result!, note: payload.responseText, communicationId: contact?.id ?? null,
          nextContactAtIso: dto.action === "schedule" ? due!.toISOString() : null } } });
      await tx.auditLog.create({ data: { organizationId: actor.organizationId, actorId: actor.id, entityType: "client_contact", entityId: customerId,
        action: dto.action === "log" ? "contact_logged" : "followup_scheduled", description: dto.action === "schedule" ? "Staff scheduled a follow-up" : dto.result === "reached" ? "Spoke to client" : "No answer",
        newValue: { requestId: dto.requestId, payload, appointmentId: contactAppointmentId, taskId, result: dto.result ?? null, communicationId: contact?.id ?? null } } });
      return { ok: true };
    });
  }

  async clients(query: FollowupClientsDto, authorization?: string) {
    const actor = await this.auth.requireSession(authorization); assertClinicOperator(actor);
    const scope = recallAppointmentLocationScope(actor);
    const now = new Date();
    const recent = query.view !== "all" && query.view !== "not_contacted";
    const locationIds = scope.locationId && typeof scope.locationId === "object" && "in" in scope.locationId ? scope.locationId.in as string[] : null;
    const where: Prisma.CustomerWhereInput = { organizationId: actor.organizationId,
      ...(query.customerId ? { id: query.customerId } : { archivedAt: null, mergedIntoCustomerId: null }),
      ...((recent && !query.customerId) || Object.keys(scope).length || query.appointmentId ? { appointments: { some: { organizationId: actor.organizationId, ...scope,
        ...(query.appointmentId ? { id: query.appointmentId, status: "Completed" } : recent && !query.customerId ? { status: "Completed", startsAt: { gte: new Date(now.getTime() - 30 * 86400000), lte: now } } : {}) } } } : {}),
      ...(query.query?.trim() ? { OR: [{ fullName: { contains: query.query.trim(), mode: "insensitive" } }, { phone: { contains: query.query.trim() } }] } : {}) };
    if (query.cursor && !await this.prisma.customer.findFirst({ where: { AND: [where, { id: query.cursor }] }, select: { id: true } })) throw new ConflictException("The client list changed. Refresh it");
    let candidateIds: string[] | null = null;
    if (query.view === "not_contacted" && !query.customerId) {
      const daysInput: unknown = query.uncontactedDays ?? 30;
      const days = typeof daysInput === "number" ? daysInput : typeof daysInput === "string" && /^\d+$/.test(daysInput) ? Number(daysInput) : NaN;
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new BadRequestException("Choose between 1 and 3650 days");
      const cutoff = new Date(adDateKeyInTimeZone(now) + "T00:00:00+05:45"); cutoff.setTime(cutoff.getTime() - days * 86400000);
      const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH contacts AS (${contactEvents(actor.organizationId)})
        SELECT c."id" FROM "Customer" c WHERE c."organizationId" = ${actor.organizationId} AND c."archivedAt" IS NULL AND c."mergedIntoCustomerId" IS NULL
        ${query.query?.trim() ? Prisma.sql`AND (position(lower(${query.query.trim()}) in lower(c."fullName")) > 0 OR position(${query.query.trim()} in c."phone") > 0)` : Prisma.empty}
        ${locationIds ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Appointment" visible WHERE visible."customerId" = c."id" AND visible."organizationId" = c."organizationId" AND visible."locationId" IN (${Prisma.join(locationIds.length ? locationIds : ["__no_grant__"])}))` : Prisma.empty}
        ${query.appointmentId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Appointment" visit WHERE visit."id" = ${query.appointmentId} AND visit."customerId" = c."id" AND visit."organizationId" = c."organizationId" AND visit."status" = 'Completed')` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM contacts event LEFT JOIN "Appointment" a ON a."id" = event."appointmentId" AND a."organizationId" = c."organizationId"
          WHERE event."customerId" = c."id" AND event."result" IN ('reached','contact_later','appointment_needed','provider_attention') AND event."occurredAt" >= ${cutoff}
          ${locationIds ? Prisma.sql`AND a."locationId" IN (${Prisma.join(locationIds.length ? locationIds : ["__no_grant__"])})` : Prisma.empty})
        ${query.cursor ? Prisma.sql`AND (c."fullName",c."id") > (SELECT anchor."fullName",anchor."id" FROM "Customer" anchor WHERE anchor."id" = ${query.cursor} AND anchor."organizationId" = c."organizationId")` : Prisma.empty}
        ORDER BY c."fullName",c."id" LIMIT 26
      `);
      candidateIds = candidates.map(row => row.id);
    }
    const clients = await this.prisma.customer.findMany({ where: candidateIds ? { AND: [where, { id: { in: candidateIds } }] } : where, take: 26, orderBy: [{ fullName: "asc" }, { id: "asc" }], ...(query.cursor && !candidateIds ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, fullName: true, phone: true, patientCode: true, archivedAt: true, mergedIntoCustomerId: true,
        appointments: { where: { organizationId: actor.organizationId, ...scope, status: "Completed", ...(query.appointmentId ? { id: query.appointmentId } : { startsAt: { lte: now } }) }, select: visitSelect, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 1 },
        // Upcoming visit context is fetched separately below; completed visits remain the suggestion source.
        followUpTasks: { where: { organizationId: actor.organizationId, status: { not: "Done" }, ...(Object.keys(scope).length ? { appointment: { is: scope } } : {}) }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 1, select: { dueAt: true, dateOnly: true } },
      } });
    const page = clients.slice(0, 25);
    const contacts = page.length ? await this.prisma.$queryRaw<Array<{ customerId: string; lastAttempt: Date | null; lastReached: Date | null }>>(Prisma.sql`
      WITH contacts AS (${contactEvents(actor.organizationId)})
      SELECT c."customerId", MAX(c."occurredAt") AS "lastAttempt",
        MAX(c."occurredAt") FILTER (WHERE c."result" IN ('reached','contact_later','appointment_needed','provider_attention')) AS "lastReached"
      FROM contacts c LEFT JOIN "Appointment" a ON a."id" = c."appointmentId" AND a."organizationId" = ${actor.organizationId}
      WHERE c."customerId" IN (${Prisma.join(page.map(client => client.id))})
      ${locationIds ? Prisma.sql`AND a."locationId" IN (${Prisma.join(locationIds.length ? locationIds : ["__no_grant__"])})` : Prisma.empty}
      GROUP BY c."customerId"
    `) : [];
    const latest = new Map(contacts.map(item => [item.customerId, item]));
    const upcoming = page.length ? await this.prisma.appointment.findMany({ where: { organizationId: actor.organizationId, ...scope, customerId: { in: page.map(client => client.id) },
      status: { in: ["Scheduled", "Confirmed", "CheckedIn", "InProgress"] }, startsAt: { gte: now } },
      distinct: ["customerId"], take: 25, orderBy: [{ startsAt: "asc" }, { id: "asc" }], select: { customerId: true, startsAt: true } }) : [];
    const returning = new Map(upcoming.map(visit => [visit.customerId, visit.startsAt.toISOString()]));
    const today = new Date(adDateKeyInTimeZone(now) + "T00:00:00+05:45");
    const planned = page.length ? await this.prisma.followUpTask.findMany({ where: { organizationId: actor.organizationId, customerId: { in: page.map(client => client.id) },
      status: { not: "Done" }, ...(Object.keys(scope).length ? { appointment: { is: scope } } : {}),
      OR: [{ dueAt: { gt: now } }, { dateOnly: true, dueAt: { gte: today } }, { dateOnly: null, dueAt: today }] },
      distinct: ["customerId"], take: 25, orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { id: true, customerId: true, appointmentId: true, dueAt: true, dateOnly: true, nextAction: true, updatedAt: true, ownerId: true,
        appointment: { select: { providerId: true, locationId: true } } } }) : [];
    const nextFollowups = new Map(planned.map(task => [task.customerId, task]));
    const history = query.customerId && page.length ? await this.prisma.$queryRaw<Array<{ id: string; description: string | null; createdAt: Date; recordedAt: Date; actor: string | null; newValue: Prisma.JsonObject | null }>>(Prisma.sql`
      WITH history AS (
        SELECT c."id", c."summary" AS "description", c."occurredAt" AS "createdAt", c."recordedAt", c."recordedByUserId" AS "actorId", c."appointmentId",
          jsonb_build_object('channel',c."channel",'direction',c."direction",'source',c."source",'result',c."result",'responseText',c."responseText",'note',c."metadata"->>'staffNote') AS "newValue"
        FROM "CommunicationLog" c WHERE c."organizationId" = ${actor.organizationId} AND c."customerId" = ${query.customerId} AND c."purpose" = 'follow_up'
        UNION ALL
        SELECT l."id", l."description", l."createdAt", l."createdAt", l."actorId", l."newValue"->>'appointmentId', l."newValue" FROM "AuditLog" l
        WHERE l."organizationId" = ${actor.organizationId} AND l."entityType" = 'client_contact' AND l."entityId" = ${query.customerId}
          AND l."newValue"->>'communicationId' IS NULL
          AND NOT EXISTS (SELECT 1 FROM "CommunicationLog" migrated WHERE migrated."organizationId" = l."organizationId" AND migrated."metadata"->>'auditLogId' = l."id")
        UNION ALL
        SELECT l."id", l."description", l."createdAt", l."createdAt", l."actorId", t."appointmentId", l."newValue"
        FROM "AuditLog" l JOIN "FollowUpTask" t ON t."id" = l."entityId" AND t."organizationId" = l."organizationId"
        WHERE l."organizationId" = ${actor.organizationId} AND t."customerId" = ${query.customerId} AND l."entityType" = 'follow_up'
          AND l."action" IN ('response_logged','rescheduled','completed','procedure_review_created')
          AND l."newValue"->>'communicationId' IS NULL
          AND NOT EXISTS (SELECT 1 FROM "CommunicationLog" migrated WHERE migrated."organizationId" = l."organizationId" AND migrated."metadata"->>'auditLogId' = l."id")
          AND NOT EXISTS (SELECT 1 FROM "AuditLog" mirrored WHERE mirrored."organizationId" = l."organizationId"
            AND mirrored."entityType" = 'client_contact' AND mirrored."entityId" = t."customerId"
            AND mirrored."newValue"->>'taskId' = t."id" AND mirrored."createdAt" = l."createdAt" AND mirrored."actorId" IS NOT DISTINCT FROM l."actorId")
      )
      SELECT l."id", l."description", l."createdAt", l."recordedAt", l."newValue", u."name" AS "actor" FROM history l
      LEFT JOIN "User" u ON u."id" = l."actorId"
      LEFT JOIN "Appointment" a ON a."id" = l."appointmentId" AND a."organizationId" = ${actor.organizationId}
      WHERE TRUE
      ${locationIds ? Prisma.sql`AND a."locationId" IN (${Prisma.join(locationIds.length ? locationIds : ["__no_grant__"])})` : Prisma.empty}
      ORDER BY l."createdAt" DESC,l."id" DESC LIMIT 50
    `) : [];
    return { items: page.map(client => { const visit = client.appointments[0]; const contact = latest.get(client.id);
      const plannedTask = nextFollowups.get(client.id);
      return { customerId: client.id, name: client.fullName, phone: client.phone, code: client.patientCode,
        visit: visit ? { id: visit.id, atIso: visit.startsAt.toISOString(), label: visit.customProcedureName || visit.services.map(item => item.service.name).join(", ") || "Completed visit", provider: visit.provider.displayName } : null,
        lastAttemptAtIso: contact?.lastAttempt?.toISOString() ?? null, lastReachedAtIso: contact?.lastReached?.toISOString() ?? null,
        nextContactAtIso: client.followUpTasks[0]?.dueAt.toISOString() ?? null,
        nextContactDateOnly: client.followUpTasks[0]?.dateOnly ?? null,
        upcomingVisitAtIso: returning.get(client.id) ?? null,
        upcomingFollowup: plannedTask ? { id: plannedTask.id, appointmentId: plannedTask.appointmentId, dueAtIso: plannedTask.dueAt.toISOString(), dateOnly: plannedTask.dateOnly,
          reason: plannedTask.nextAction, updatedAtIso: plannedTask.updatedAt.toISOString(), canManage: !client.archivedAt && !client.mergedIntoCustomerId && canManageFollowup(actor, plannedTask) } : null,
        canManage: !client.archivedAt && !client.mergedIntoCustomerId && canManageFollowup(actor, { appointment: visit ?? null, ownerId: visit?.providerId ?? null }) };
    }), history: history.map(row => ({ id: row.id, label: row.description, atIso: row.createdAt.toISOString(), actor: row.actor ?? "Former staff",
      channel: row.newValue?.channel ?? null, direction: row.newValue?.direction ?? null, source: row.newValue?.source ?? null, result: row.newValue?.result ?? null,
      responseText: row.newValue?.responseText ?? null, recordedAtIso: row.recordedAt.toISOString(),
      note: row.newValue?.note ?? null,
      dueAtIso: row.newValue?.dueAtIso ?? row.newValue?.nextContactAtIso ?? (row.newValue?.payload && typeof row.newValue.payload === "object" ? (row.newValue.payload as Prisma.JsonObject).dueAtIso : null) })),
      page: { hasMore: clients.length > 25, nextCursor: clients.length > 25 ? page.at(-1)!.id : null } };
  }
}

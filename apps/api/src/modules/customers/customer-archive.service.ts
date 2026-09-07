import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { AuthService, type AuthSession, type AuthSessionReference } from "../auth/auth.service";
import { assertClinicAdmin, assertClinicOperator, hasRole } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomerArchiveService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async listArchived(authorization?: AuthSessionReference) {
    const actor = await this.requireClinicAdmin(authorization);
    return this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      select: {
        id: true, fullName: true, patientCode: true, archivedAt: true, archiveReason: true,
        archivedByUserId: true, retentionUntil: true, legalHoldAt: true, legalHoldReason: true,
      },
    });
  }

  async archive(id: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireClinicOperator(authorization);
    if (!reason.trim()) throw new BadRequestException("Archive reason is required");
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!customer) throw new NotFoundException("Client not found or already archived");
    const archivedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { archivedAt, archivedByUserId: actor.id, archiveReason: reason.trim() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "customer",
          entityId: customer.id,
          action: "archived",
          newValue: { reason: reason.trim(), archivedAt: archivedAt.toISOString() },
          description: "Client archived",
        },
      });
    });
    return { ok: true, archivedAt };
  }

  async restore(id: string, authorization?: AuthSessionReference) {
    const actor = await this.requireClinicAdmin(authorization);
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: { not: null } },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Archived client not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { archivedAt: null, archivedByUserId: null, archiveReason: null },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "customer",
          entityId: customer.id,
          action: "restored",
          description: "Client restored from archive",
        },
      });
    });
    return { ok: true };
  }

  async purge(id: string, confirmationId: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireOwner(authorization);
    if (confirmationId !== id) throw new BadRequestException("Typed client confirmation does not match the purge target");
    if (!reason.trim()) throw new BadRequestException("Permanent deletion reason is required");
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: { not: null } },
      select: { id: true, organizationId: true, archivedAt: true, retentionUntil: true, legalHoldAt: true, legalHoldReason: true },
    });
    if (!customer) throw new NotFoundException("Archived client not found");
    if (customer.legalHoldAt) throw new ForbiddenException("Client is under legal hold and cannot be permanently deleted");
    if (customer.retentionUntil && customer.retentionUntil > new Date()) {
      throw new ForbiddenException("Client retention period has not ended");
    }
    const [
      appointments,
      reports,
      followUps,
      communications,
      invoices,
      payments,
      charts,
      revisions,
      mergeLineage,
      aliases,
      mergeSecondaries,
    ] = await Promise.all([
      this.prisma.appointment.count({ where: { customerId: id } }),
      this.prisma.appointmentSession.count({ where: { customerId: id } }),
      this.prisma.followUpTask.count({ where: { customerId: id } }),
      this.prisma.communicationLog.count({ where: { customerId: id } }),
      this.prisma.invoice.count({ where: { customerId: id } }),
      this.prisma.payment.count({ where: { customerId: id } }),
      this.prisma.patientDentalChart.count({ where: { customerId: id } }),
      this.prisma.dentalChartRevision.count({ where: { customerId: id } }),
      this.prisma.clientMerge.count({
        where: { OR: [{ primaryCustomerId: id }, { secondaryCustomerId: id }] },
      }),
      this.prisma.clientAlias.count({ where: { customerId: id } }),
      this.prisma.customer.count({ where: { mergedIntoCustomerId: id } }),
    ]);
    if (appointments || reports || followUps || communications || invoices || payments || charts || revisions) {
      throw new BadRequestException("Client cannot be permanently deleted while operational, financial, or clinical history exists");
    }
    if (mergeSecondaries) {
      throw new BadRequestException(
        "Client cannot be permanently deleted while archived merge-secondary Clients depend on its canonical identity",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: customer.organizationId,
          actorId: actor.id,
          entityType: "customer_tombstone",
          entityId: customer.id,
          action: "permanently_deleted",
          oldValue: { archivedAt: customer.archivedAt?.toISOString() ?? null },
          newValue: {
            confirmationId,
            reason: reason.trim(),
            removedGovernanceLinks: { mergeLineage, aliases, mergeSecondaries },
          },
          description: "Owner confirmed permanent client deletion from archive",
        },
      });
      await tx.clientMerge.deleteMany({
        where: { OR: [{ primaryCustomerId: customer.id }, { secondaryCustomerId: customer.id }] },
      });
      await tx.clientAlias.deleteMany({ where: { customerId: customer.id } });
      await tx.customer.delete({ where: { id: customer.id } });
    });
    return { ok: true };
  }

  private async requireClinicOperator(authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    return actor;
  }

  private async requireClinicAdmin(authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    assertClinicAdmin(actor);
    return actor;
  }

  private async requireOwner(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!hasRole(actor, "Owner")) throw new ForbiddenException("Only an Owner can permanently delete an archived client");
    return actor;
  }
}

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { SupportAccessGrantStatus, UserRole } from "@prisma/client";

import { AuthService, type AuthSession, type AuthSessionReference } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSupportAccessGrantDto } from "./dto/create-support-access-grant.dto";
import { UpdateFeatureFlagDto } from "./dto/update-feature-flag.dto";

// Support grants are configuration-only in this phase.  The permitted domains
// intentionally exclude identifiable Client, Record, and financial data until
// a separately reviewed, purpose-built support workflow exists.
const SUPPORT_ACCESS_DOMAINS = new Set([
  "organization_configuration",
  "operational_metadata",
  "scheduling_metadata",
]);

@Injectable()
export class PlatformService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async aggregateMetrics(authorization?: AuthSessionReference) {
    await this.requireSuperAdmin(authorization);
    const [organizationCount, activeStaffCount, adoptionRows] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count({ where: { organizationId: { not: null }, status: "Active" } }),
      this.prisma.featureAdoptionEvent.findMany({ distinct: ["organizationId", "featureKey"], select: { featureKey: true } }),
    ]);
    const adoption = new Map<string, number>();
    adoptionRows.forEach((row) => adoption.set(row.featureKey, (adoption.get(row.featureKey) ?? 0) + 1));
    return {
      organizations: { total: organizationCount },
      activeStaff: activeStaffCount,
      featureAdoption: [...adoption.entries()].map(([featureKey, organizationCount]) => ({ featureKey, organizationCount })),
    };
  }

  async listFeatureFlags(authorization?: AuthSessionReference) {
    await this.requireSuperAdmin(authorization);
    return this.prisma.platformFeatureFlag.findMany({
      select: { key: true, enabled: true, description: true, updatedAt: true, updatedByUserId: true },
      orderBy: { key: "asc" },
    });
  }

  async updateFeatureFlag(key: string, dto: UpdateFeatureFlagDto, authorization?: AuthSessionReference) {
    const actor = await this.requireSuperAdmin(authorization);
    if (!dto.reason.trim()) throw new BadRequestException("Feature flag change reason is required");
    const flag = await this.prisma.platformFeatureFlag.upsert({
      where: { key },
      create: { key, enabled: dto.enabled, description: dto.description, updatedByUserId: actor.id },
      update: { enabled: dto.enabled, description: dto.description, updatedByUserId: actor.id },
    });
    await this.audit(actor, "platform_feature_flag", key, "updated", { enabled: dto.enabled, reason: dto.reason.trim() });
    return flag;
  }

  async setOrganizationFeatureOverride(
    featureKey: string,
    organizationId: string,
    dto: UpdateFeatureFlagDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireSuperAdmin(authorization);
    if (!dto.reason.trim()) throw new BadRequestException("Feature override reason is required");
    const [flag, organization] = await Promise.all([
      this.prisma.platformFeatureFlag.findUnique({ where: { key: featureKey }, select: { key: true } }),
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    ]);
    if (!flag) throw new NotFoundException("Platform feature flag not found");
    if (!organization) throw new NotFoundException("Organization not found");
    const override = await this.prisma.organizationFeatureOverride.upsert({
      where: { organizationId_featureKey: { organizationId, featureKey } },
      create: { organizationId, featureKey, enabled: dto.enabled, reason: dto.reason.trim(), updatedByUserId: actor.id },
      update: { enabled: dto.enabled, reason: dto.reason.trim(), updatedByUserId: actor.id },
    });
    await this.audit(actor, "organization_feature_override", override.id, "updated", { organizationId, featureKey, enabled: dto.enabled, reason: dto.reason.trim() }, organizationId);
    return override;
  }

  async listSupportAccessGrants(authorization?: AuthSessionReference) {
    await this.requireSuperAdmin(authorization);
    const grants = await this.prisma.supportAccessGrant.findMany({
      select: {
        id: true, organizationId: true, requestedByUserId: true, reason: true, dataDomains: true, readOnly: true,
        startsAt: true, expiresAt: true, status: true, revokedAt: true, revokedReason: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return grants.map((grant) => ({
      ...grant,
      effectiveStatus: grant.status === SupportAccessGrantStatus.Active && grant.expiresAt <= now
        ? SupportAccessGrantStatus.Expired
        : grant.status,
    }));
  }

  async createSupportAccessGrant(dto: CreateSupportAccessGrantDto, authorization?: AuthSessionReference) {
    const actor = await this.requireSuperAdmin(authorization);
    if (!dto.reason.trim()) throw new BadRequestException("Support-access reason is required");
    if (dto.readOnly === false) throw new BadRequestException("Support access is read-only by default and write access is not implemented");
    const startsAt = new Date(dto.startsAtIso);
    const expiresAt = new Date(dto.expiresAtIso);
    if (startsAt >= expiresAt || expiresAt <= new Date()) throw new BadRequestException("Support-access expiry must be in the future and after its start");
    const dataDomains = [...new Set(dto.dataDomains.map((domain) => domain.trim()).filter(Boolean))];
    if (!dataDomains.length || dataDomains.some((domain) => !SUPPORT_ACCESS_DOMAINS.has(domain))) {
      throw new BadRequestException("Support-access domains must be approved configuration-only domains");
    }
    const organization = await this.prisma.organization.findUnique({ where: { id: dto.organizationId }, select: { id: true } });
    if (!organization) throw new NotFoundException("Organization not found");
    const grant = await this.prisma.supportAccessGrant.create({
      data: {
        organizationId: organization.id,
        requestedByUserId: actor.id,
        reason: dto.reason.trim(),
        dataDomains,
        readOnly: true,
        startsAt,
        expiresAt,
      },
    });
    await this.audit(actor, "support_access_grant", grant.id, "created", {
      organizationId: organization.id, reason: grant.reason, dataDomains: grant.dataDomains, readOnly: true,
      startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString(),
    }, organization.id);
    return grant;
  }

  async revokeSupportAccessGrant(id: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireSuperAdmin(authorization);
    if (!reason.trim()) throw new BadRequestException("Support-access revocation reason is required");
    const grant = await this.prisma.supportAccessGrant.findUnique({ where: { id }, select: { id: true, organizationId: true, status: true } });
    if (!grant) throw new NotFoundException("Support-access grant not found");
    const revoked = await this.prisma.supportAccessGrant.update({
      where: { id },
      data: { status: SupportAccessGrantStatus.Revoked, revokedAt: new Date(), revokedByUserId: actor.id, revokedReason: reason.trim() },
    });
    await this.audit(actor, "support_access_grant", id, "revoked", { reason: reason.trim(), previousStatus: grant.status }, grant.organizationId);
    return revoked;
  }

  private async requireSuperAdmin(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (actor.role !== UserRole.SuperAdmin) throw new ForbiddenException("Only a Super Admin can access platform controls");
    return actor;
  }

  private audit(actor: AuthSession, entityType: string, entityId: string, action: string, value: object, organizationId?: string) {
    if (!organizationId) {
      return this.prisma.platformAuditEvent.create({
        data: { actorUserId: actor.id, entityType, entityId, action, payload: value, description: "Platform control lifecycle event" },
      });
    }
    return this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId: actor.id,
        entityType,
        entityId,
        action,
        newValue: value,
        description: "Platform control lifecycle event",
      },
    });
  }
}

import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClientIdentityReviewStatus, Prisma, UserRole } from "@prisma/client";

import { AuthService, type AuthSession, type AuthSessionReference } from "../auth/auth.service";
import {
  assertClinicOperator,
  clientIdentityCreateRoles,
  clientPhoneAppendRoles,
  clientIdentityWriteRoles,
  hasAnyRole,
} from "../auth/authz";
import { normalizeClientPhone } from "../customers/client-phone-normalization";
import {
  buildClientCandidateSetVersion,
  clientPhoneNormalizationVersion,
} from "../customers/client-match-version";
import { PrismaService } from "../prisma/prisma.service";
import { adDateKeyInTimeZone, isValidAdDateKey } from "../scheduling/ad-date-key";
import { boundedInteger } from "./bounded-integer";
import {
  type AppendClientPhoneDto,
  type AppendCallerPhoneDto,
  type ClientDirectoryQueryDto,
  type ClientIdentityReviewQueryDto,
  type ClientIdentityDto,
  type CreateClientDto,
  type MatchClientsDto,
  type NumberFirstClientMatchDto,
  type ResolveClientIdentityReviewDto,
} from "./dto/client-hub.dto";

const pageDefault = 25;
const identityReviewRoles = new Set<UserRole>([
  UserRole.Owner,
  UserRole.Admin,
  UserRole.Manager,
]);
const phoneNormalizationVersion = clientPhoneNormalizationVersion;
const maxSerializableAttempts = 3;

type ClientCreationResponse = {
  id: string;
  clientCode: string | null;
  name: string;
  phone: string;
  identityReview: {
    id: string;
    status: ClientIdentityReviewStatus;
    triggers: string[];
  } | null;
  replayed: boolean;
  [key: string]: unknown;
};
type ClientCreationReplayCustomer = {
  id: string;
  patientCode: string | null;
  fullName: string;
  phone: string;
};

@Injectable()
export class ClientsV1Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async list(query: ClientDirectoryQueryDto, authorization?: AuthSessionReference) {
    const actor = await this.requireOperator(authorization);
    const limit = boundedInteger(query.limit, {
      defaultValue: pageDefault,
      field: "limit",
      max: 100,
    });
    const search = query.query?.trim();
    const where: Prisma.CustomerWhereInput = {
      organizationId: actor.organizationId,
      archivedAt: null,
      mergedIntoCustomerId: null,
      ...(search ? { OR: this.searchWhere(search) } : {}),
    };
    const rows = await this.prisma.customer.findMany({
      where,
      select: this.directorySelect,
      orderBy:
        query.order === "recent"
          ? [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }]
          : [{ fullName: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.mapDirectoryClient(row));

    return {
      items,
      page: {
        limit,
        count: items.length,
        hasMore,
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      },
    };
  }

  async getOne(id: string, authorization?: AuthSessionReference) {
    const actor = await this.requireOperator(authorization);
    const client = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId },
      select: {
        ...this.clientSelect,
        mergedIntoCustomer: { select: { id: true, fullName: true, patientCode: true } },
        primaryMerges: {
          select: {
            id: true,
            createdAt: true,
            reason: true,
            secondaryCustomer: { select: { id: true, fullName: true, patientCode: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!client) throw new NotFoundException("Client not found");

    const [appointments, followUps, invoices, communications] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { customerId: id, organizationId: actor.organizationId },
        select: { id: true, startsAt: true, status: true, provider: { select: { displayName: true } } },
        orderBy: { startsAt: "desc" },
        take: 15,
      }),
      this.prisma.followUpTask.findMany({
        where: { customerId: id, organizationId: actor.organizationId },
        select: { id: true, dueAt: true, status: true, summary: true },
        orderBy: { dueAt: "desc" },
        take: 15,
      }),
      this.prisma.invoice.findMany({
        where: { customerId: id, organizationId: actor.organizationId },
        select: { id: true, invoiceNumber: true, status: true, issuedAt: true, balanceAmount: true },
        orderBy: { issuedAt: "desc" },
        take: 15,
      }),
      this.prisma.communicationLog.findMany({
        where: { customerId: id, organizationId: actor.organizationId },
        select: { id: true, channel: true, direction: true, summary: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 15,
      }),
    ]);

    const timeline = [
      ...appointments.map((item) => ({
        id: `appointment:${item.id}`,
        atIso: item.startsAt.toISOString(),
        kind: "appointment",
        title: `${item.status} appointment`,
        detail: item.provider.displayName,
      })),
      ...followUps.map((item) => ({
        id: `follow-up:${item.id}`,
        atIso: item.dueAt.toISOString(),
        kind: "follow_up",
        title: item.summary,
        detail: item.status,
      })),
      ...invoices.map((item) => ({
        id: `invoice:${item.id}`,
        atIso: item.issuedAt.toISOString(),
        kind: "invoice",
        title: `Invoice ${item.invoiceNumber}`,
        detail: `${item.status} · NPR ${item.balanceAmount.toString()}`,
      })),
      ...communications.map((item) => ({
        id: `communication:${item.id}`,
        atIso: item.occurredAt.toISOString(),
        kind: "communication",
        title: item.summary,
        detail: `${item.direction} ${item.channel}`,
      })),
    ]
      .sort((left, right) => right.atIso.localeCompare(left.atIso))
      .slice(0, 30);

    return {
      client: this.mapClient(client),
      merge: client.mergedIntoCustomer
        ? {
            mergedInto: {
              id: client.mergedIntoCustomer.id,
              name: client.mergedIntoCustomer.fullName,
              clientCode: client.mergedIntoCustomer.patientCode,
            },
          }
        : null,
      mergeHistory: client.primaryMerges.map((merge) => ({
        id: merge.id,
        atIso: merge.createdAt.toISOString(),
        reason: merge.reason,
        secondaryClient: {
          id: merge.secondaryCustomer.id,
          name: merge.secondaryCustomer.fullName,
          clientCode: merge.secondaryCustomer.patientCode,
        },
      })),
      timeline,
    };
  }

  async create(
    dto: CreateClientDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ): Promise<ClientCreationResponse> {
    const actor = await this.requireClientCreator(authorization);
    this.assertClientIdentity(dto);
    const requestHash = this.clientCreateRequestHash(dto);
    const replay = await this.prisma.clientCreationReceipt.findUnique({
      where: {
        organizationId_actorUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          idempotencyKey,
        },
      },
      select: {
        requestHash: true,
        response: true,
        customer: {
          select: { id: true, patientCode: true, fullName: true, phone: true },
        },
      },
    });
    if (replay) {
      return this.replayClientCreation(
        replay.requestHash,
        requestHash,
        replay.response,
        replay.customer,
      );
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxSerializableAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            this.createClientTransaction(
              tx,
              dto,
              idempotencyKey,
              requestHash,
              actor,
            ),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 20_000,
          },
        );
      } catch (error) {
        lastError = error;
        if (!this.isSerializationFailure(error) || attempt === maxSerializableAttempts) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private async createClientTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateClientDto,
    idempotencyKey: string,
    requestHash: string,
    actor: AuthSession,
  ): Promise<ClientCreationResponse> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`${actor.organizationId}:${actor.id}:client-create:${idempotencyKey}`},
          0
        )
      )
    `);
    const existingReceipt = await tx.clientCreationReceipt.findUnique({
      where: {
        organizationId_actorUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          idempotencyKey,
        },
      },
      select: {
        requestHash: true,
        response: true,
        customer: {
          select: { id: true, patientCode: true, fullName: true, phone: true },
        },
      },
    });
    if (existingReceipt) {
      return this.replayClientCreation(
        existingReceipt.requestHash,
        requestHash,
        existingReceipt.response,
        existingReceipt.customer,
      );
    }

    const matchResult = await this.numberMatchesWithDb(
      tx,
      { phone: dto.phone, name: dto.name },
      actor.organizationId,
    );
    if (matchResult.candidateSetVersion !== dto.candidateSetVersion) {
      throw new ConflictException({
        code: "IDENTITY_MATCH_CHANGED",
        message: "Possible Client matches changed. Review them again.",
      });
    }
    const candidateIds = matchResult.matches
      .map((match) => match.client.id)
      .sort();
    const reviewedIds = [...(dto.skippedPossibleMatchClientIds ?? [])].sort();
    if (
      candidateIds.length &&
      (!dto.duplicateCheckAcknowledged ||
        candidateIds.length !== reviewedIds.length ||
        candidateIds.some((id, index) => id !== reviewedIds[index]))
    ) {
      throw new ConflictException({
        code: "MATCH_REVIEW_REQUIRED",
        message:
          "Review every possible matching Client before creating a separate record.",
      });
    }
    if (!candidateIds.length && reviewedIds.length) {
      throw new ConflictException({
        code: "IDENTITY_MATCH_CHANGED",
        message: "Possible Client matches changed. Review them again.",
      });
    }

      const clientCode = await this.allocateClientCode(tx, actor.organizationId);
      const created = await tx.customer.create({
        data: {
          organizationId: actor.organizationId,
          fullName: dto.name.trim(),
          patientCode: clientCode,
          phone: dto.phone.trim(),
          normalizedPhone: normalizeClientPhone(dto.phone),
          email: this.normalizeEmail(dto.email),
          normalizedEmail: this.normalizeEmail(dto.email),
          gender: this.blankToNull(dto.gender),
          dateOfBirth: dto.dateOfBirthIso ? new Date(dto.dateOfBirthIso) : null,
          address: this.blankToNull(dto.address),
          emergencyContactName: this.blankToNull(dto.emergencyContactName),
          emergencyContactPhone: this.blankToNull(dto.emergencyContactPhone),
          allergies: this.blankToNull(dto.allergies),
          medicalNotes: this.blankToNull(dto.medicalNotes),
          riskLabel: dto.risk,
          dentalChart: { create: { chartData: { segments: [], notes: [], version: 1 }, version: 1 } },
        },
        select: this.clientSelect,
      });
      await tx.clientPhone.create({
        data: {
          organizationId: actor.organizationId,
          customerId: created.id,
          rawValue: dto.phone.trim(),
          normalizedValue: normalizeClientPhone(dto.phone),
          normalizationVersion: phoneNormalizationVersion,
          type: "Mobile",
          isPrimary: true,
          source: "ClientCreate",
          createdByUserId: actor.id,
        },
      });
      const reviewTriggers = [
        ...(dto.priorVisitedClinic ? ["prior_visit_claim"] : []),
        ...(candidateIds.length
          ? ["skipped_possible_matches"]
          : []),
      ];
      const identityReview = reviewTriggers.length
        ? await tx.clientIdentityReview.create({
            data: {
              organizationId: actor.organizationId,
              customerId: created.id,
              reason: dto.priorVisitedClinic ? "PriorVisitClaim" : "SkippedPossibleMatches",
              candidateSnapshot: matchResult.matches.map((match) => ({
                customerId: match.client.id,
                score:
                  match.classification === "strong"
                    ? 135
                    : match.matchedOn.includes("phone")
                      ? 100
                      : 35,
                confidence: match.classification,
                matchedOn: match.matchedOn,
              })),
              context: {
                triggers: reviewTriggers,
                source: "client_create",
                normalizationVersion: phoneNormalizationVersion,
                candidateSetVersion: matchResult.candidateSetVersion,
              },
              createdByUserId: actor.id,
            },
            select: { id: true, status: true },
          })
        : null;
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "client",
          entityId: created.id,
          action: "created",
          newValue: {
            clientCode,
            duplicateCheckAcknowledged: Boolean(dto.duplicateCheckAcknowledged),
            candidateSetVersion: matchResult.candidateSetVersion,
            reviewedCandidateIds: candidateIds,
            identityReviewId: identityReview?.id ?? null,
            fields: this.safeIdentityAudit(dto),
          },
          description: "Client created",
        },
      });
      const response: ClientCreationResponse = {
        id: created.id,
        clientCode: created.patientCode,
        name: created.fullName,
        phone: created.phone,
        identityReview: identityReview
        ? {
            id: identityReview.id,
            status: identityReview.status,
            triggers: reviewTriggers,
          }
        : null,
        replayed: false,
      };
      await tx.clientCreationReceipt.create({
        data: {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          idempotencyKey,
          requestHash,
          customerId: created.id,
          response: {
            id: response.id,
            clientCode: response.clientCode,
            identityReview: response.identityReview,
          } as unknown as Prisma.InputJsonObject,
        },
      });
      return response;
  }

  async update(id: string, dto: ClientIdentityDto, authorization?: AuthSessionReference) {
    const actor = await this.requireClientWriter(authorization);
    this.assertClientIdentity(dto);
    const existing = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: null, mergedIntoCustomerId: null },
      select: this.clientSelect,
    });
    if (!existing) throw new NotFoundException("Active Client not found");

    const client = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.customer.updateMany({
        where: {
          id,
          organizationId: actor.organizationId,
          archivedAt: null,
          mergedIntoCustomerId: null,
        },
        data: {
          fullName: dto.name.trim(),
          phone: dto.phone.trim(),
          normalizedPhone: normalizeClientPhone(dto.phone),
          email: this.normalizeEmail(dto.email),
          normalizedEmail: this.normalizeEmail(dto.email),
          gender: this.blankToNull(dto.gender),
          dateOfBirth: dto.dateOfBirthIso ? new Date(dto.dateOfBirthIso) : null,
          address: this.blankToNull(dto.address),
          emergencyContactName: this.blankToNull(dto.emergencyContactName),
          emergencyContactPhone: this.blankToNull(dto.emergencyContactPhone),
          allergies: this.blankToNull(dto.allergies),
          medicalNotes: this.blankToNull(dto.medicalNotes),
          riskLabel: dto.risk,
        },
      });
      if (changed.count !== 1) throw new NotFoundException("Active Client not found");
      await this.syncPrimaryPhone(
        tx,
        id,
        actor.organizationId,
        dto.phone,
        actor.id,
        "V1ProfileCorrection",
      );
      const updated = await tx.customer.findUniqueOrThrow({
        where: { id },
        select: this.clientSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "client",
          entityId: id,
          action: "profile_corrected",
          oldValue: this.safeClientAudit(existing),
          newValue: this.safeIdentityAudit(dto),
          description: "Client administrative profile corrected",
        },
      });
      return updated;
    });

    return this.mapClient(client);
  }

  async match(dto: MatchClientsDto, authorization?: AuthSessionReference) {
    const actor = await this.requireOperator(authorization);
    return { matches: await this.findMatches(actor.organizationId, dto) };
  }

  async numberMatches(dto: NumberFirstClientMatchDto, authorization?: AuthSessionReference) {
    const actor = await this.requireOperator(authorization);
    return this.numberMatchesWithDb(this.prisma, dto, actor.organizationId);
  }

  private async numberMatchesWithDb(
    db: Pick<Prisma.TransactionClient, "customer">,
    dto: NumberFirstClientMatchDto,
    organizationId: string,
  ) {
    const normalizedPhone = this.assertValidPhone(dto.phone);
    const normalizedName = dto.name ? this.normalizeName(dto.name) : "";
    const matchSelect = {
      id: true,
      patientCode: true,
      fullName: true,
      phone: true,
      normalizedPhone: true,
      lastVisitAt: true,
      updatedAt: true,
      phones: {
        where: { archivedAt: null },
        select: {
          id: true,
          rawValue: true,
          normalizedValue: true,
          label: true,
          type: true,
          isPrimary: true,
          updatedAt: true,
        },
        orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
      },
    } satisfies Prisma.CustomerSelect;
    const exactRows = await db.customer.findMany({
      where: {
        organizationId,
        archivedAt: null,
        mergedIntoCustomerId: null,
        OR: [
          { normalizedPhone },
          { phones: { some: { normalizedValue: normalizedPhone, archivedAt: null } } },
        ],
      },
      select: matchSelect,
      take: 6,
      orderBy: [{ updatedAt: "desc" }],
    });
    const exactIds = exactRows.map((row) => row.id);
    const nameRows = normalizedName && exactRows.length < 6
        ? await db.customer.findMany({
            where: {
              organizationId,
            archivedAt: null,
            mergedIntoCustomerId: null,
            id: { notIn: exactIds },
            fullName: { contains: dto.name!.trim(), mode: "insensitive" },
          },
          select: matchSelect,
          take: 6 - exactRows.length,
          orderBy: [{ updatedAt: "desc" }],
        })
      : [];
    const rows = [...exactRows, ...nameRows];
    const sharedHousehold = exactIds.length > 1;
    const matches = rows
      .map((row) => {
        const phoneMatch = exactIds.includes(row.id);
        const nameMatch = Boolean(normalizedName && this.normalizeName(row.fullName) === normalizedName);
        if (!phoneMatch && !nameMatch) return null;
        const classification: "shared_household" | "strong" | "possible" =
          phoneMatch && sharedHousehold
            ? "shared_household"
            : phoneMatch && nameMatch
              ? "strong"
              : "possible";
        const phoneSummaries = row.phones.length
          ? row.phones.map((phone) => ({
              id: phone.id,
              displayValue: phone.rawValue,
              label: phone.label ?? phone.type,
              isPrimary: phone.isPrimary,
            }))
          : [{
              id: `legacy:${row.id}`,
              displayValue: row.phone,
              label: "Mobile",
              isPrimary: true,
            }];
        return {
          classification,
          matchedOn: [
            ...(phoneMatch ? ["phone" as const] : []),
            ...(nameMatch ? ["name" as const] : []),
          ],
          client: {
            id: row.id,
            clientCode: row.patientCode,
            name: row.fullName,
            phoneSummaries,
            lastVisitIso: row.lastVisitAt?.toISOString() ?? null,
          },
          updatedAtIso: row.updatedAt.toISOString(),
        };
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match))
      .sort((left, right) => {
        const rank = { shared_household: 3, strong: 2, possible: 1 };
        return rank[right.classification] - rank[left.classification];
      })
      .slice(0, 6);

    const matchedIds = new Set(matches.map((match) => match.client.id));
    const versionCandidates = rows
      .filter((row) => matchedIds.has(row.id))
      .map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt,
        phones: row.phones.map((phone) => ({
          id: phone.id,
          normalizedValue: phone.normalizedValue,
          updatedAt: phone.updatedAt,
        })),
      }));
    return {
      classification: matches[0]?.classification ?? "none",
      candidateSetVersion: buildClientCandidateSetVersion(
        normalizedPhone,
        versionCandidates,
      ),
      matches: matches.map(({ updatedAtIso: _updatedAtIso, ...match }) => match),
    };
  }

  async appendPhone(
    clientId: string,
    dto: AppendClientPhoneDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireClientWriter(authorization);
    const normalizedValue = this.assertValidPhone(dto.phone);
    this.assertPhoneReason(dto.reason);
    const client = await this.prisma.customer.findFirst({
      where: {
        id: clientId,
        organizationId: actor.organizationId,
        archivedAt: null,
        mergedIntoCustomerId: null,
      },
      select: { id: true },
    });
    if (!client) throw new NotFoundException("Active Client not found");
    const existing = await this.prisma.clientPhone.findFirst({
      where: { customerId: clientId, normalizedValue, archivedAt: null },
      select: this.phoneSelect,
    });
    if (existing) return { phone: this.mapPhone(existing), added: false };

    return this.appendPhoneSerializable(
      clientId,
      dto,
      normalizedValue,
      actor,
    );
  }

  async appendCallerPhone(
    clientId: string,
    dto: AppendCallerPhoneDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireClientPhoneAppender(authorization);
    const normalizedValue = this.assertValidPhone(dto.phone);
    this.assertPhoneReason(dto.reason);
    return this.appendPhoneSerializable(
      clientId,
      {
        phone: dto.phone,
        type: "Mobile",
        label: "Secondary",
        reason: dto.reason,
      },
      normalizedValue,
      actor,
      async (tx) => {
        const matches = await this.numberMatchesWithDb(
          tx,
          { name: dto.name, phone: dto.phone },
          actor.organizationId,
        );
        if (
          matches.candidateSetVersion !== dto.candidateSetVersion ||
          !matches.matches.some((match) => match.client.id === clientId)
        ) {
          throw new ConflictException({
            code: "IDENTITY_MATCH_CHANGED",
            message: "Possible Client matches changed. Review them again.",
          });
        }
      },
    );
  }

  private async appendPhoneSerializable(
    clientId: string,
    dto: AppendClientPhoneDto,
    normalizedValue: string,
    actor: AuthSession,
    beforeAppend?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxSerializableAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await beforeAppend?.(tx);
        const activeClientCount = await tx.customer.count({
          where: {
            id: clientId,
            organizationId: actor.organizationId,
            archivedAt: null,
            mergedIntoCustomerId: null,
          },
        });
          if (activeClientCount !== 1) {
            throw new NotFoundException("Active Client not found");
          }
          const existing = await tx.clientPhone.findFirst({
            where: {
              customerId: clientId,
              normalizedValue,
              archivedAt: null,
            },
            select: this.phoneSelect,
          });
          if (existing) {
            return { phone: this.mapPhone(existing), added: false };
          }
        const created = await tx.clientPhone.create({
          data: {
            organizationId: actor.organizationId,
            customerId: clientId,
            rawValue: dto.phone.trim(),
            normalizedValue,
            normalizationVersion: phoneNormalizationVersion,
            type: dto.type ?? "Mobile",
            label: this.blankToNull(dto.label),
            isPrimary: false,
            source: "ManualAppend",
            sourceMetadata: { reason: dto.reason.trim() },
            createdByUserId: actor.id,
          },
          select: this.phoneSelect,
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            entityType: "client_phone",
            entityId: created.id,
            action: "added",
            newValue: {
              clientId,
              normalizationVersion: phoneNormalizationVersion,
              type: created.type,
              label: created.label,
              last4: normalizedValue.slice(-4),
              reason: dto.reason.trim(),
            },
            description: "Secondary Client phone added",
          },
        });
          return { phone: this.mapPhone(created), added: true };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        });
      } catch (error) {
        lastError = error;
        if (this.isSerializationFailure(error) && attempt < maxSerializableAttempts) {
          continue;
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const winner = await this.prisma.clientPhone.findFirst({
            where: { customerId: clientId, normalizedValue, archivedAt: null },
            select: this.phoneSelect,
          });
          if (winner) return { phone: this.mapPhone(winner), added: false };
        }
        throw error;
      }
    }
    throw lastError;
  }

  private assertPhoneReason(reason: string) {
    if (!reason.trim()) {
      throw new BadRequestException("Phone addition reason is required");
    }
  }

  async listIdentityReviews(
    query: ClientIdentityReviewQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireIdentityReviewer(authorization);
    const limit = boundedInteger(query.limit, { defaultValue: pageDefault, field: "limit", max: 100 });
    const rows = await this.prisma.clientIdentityReview.findMany({
      where: {
        organizationId: actor.organizationId,
        archivedAt: null,
        ...(query.status ? { status: query.status as ClientIdentityReviewStatus } : {}),
      },
      select: {
        id: true,
        status: true,
        version: true,
        reason: true,
        candidateSnapshot: true,
        context: true,
        resolution: true,
        resolutionNotes: true,
        createdAt: true,
        resolvedAt: true,
        customer: { select: { id: true, patientCode: true, fullName: true } },
        resolvedCustomer: { select: { id: true, patientCode: true, fullName: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((review) => ({
      ...review,
      createdAtIso: review.createdAt.toISOString(),
      resolvedAtIso: review.resolvedAt?.toISOString() ?? null,
      createdAt: undefined,
      resolvedAt: undefined,
    }));
    return {
      items,
      page: {
        limit,
        count: items.length,
        hasMore,
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      },
    };
  }

  async resolveIdentityReview(
    reviewId: string,
    dto: ResolveClientIdentityReviewDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireIdentityReviewer(authorization);
    if (!dto.reason.trim()) throw new BadRequestException("Resolution reason is required");
    if (dto.resolution === "confirmed_existing" && !dto.resolvedClientId) {
      throw new BadRequestException("A resolved Client is required");
    }
    if (dto.resolution !== "confirmed_existing" && dto.resolvedClientId) {
      throw new BadRequestException("A resolved Client is allowed only when confirming an existing identity");
    }
    if (dto.resolvedClientId) {
      const target = await this.prisma.customer.findFirst({
        where: {
          id: dto.resolvedClientId,
          organizationId: actor.organizationId,
          archivedAt: null,
          mergedIntoCustomerId: null,
        },
        select: { id: true },
      });
      if (!target) throw new NotFoundException("Resolved Client not found");
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.clientIdentityReview.updateMany({
        where: {
          id: reviewId,
          organizationId: actor.organizationId,
          archivedAt: null,
          status: { in: ["Pending", "InReview"] },
          version: dto.expectedVersion,
        },
        data: {
          status: "Resolved",
          version: { increment: 1 },
          resolution: dto.resolution,
          resolutionNotes: dto.reason.trim(),
          resolvedCustomerId: dto.resolvedClientId ?? null,
          resolvedAt: new Date(),
          resolvedByUserId: actor.id,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException("Identity review changed; refresh before resolving");
      }
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "client_identity_review",
          entityId: reviewId,
          action: "resolved",
          newValue: {
            resolution: dto.resolution,
            resolvedClientId: dto.resolvedClientId ?? null,
            expectedVersion: dto.expectedVersion,
          },
          description: "Client identity review resolved",
        },
      });
      const review = await tx.clientIdentityReview.findUniqueOrThrow({
        where: { id: reviewId },
        select: { id: true, status: true, version: true, resolution: true, resolvedAt: true },
      });
      return {
        id: review.id,
        status: review.status,
        version: review.version,
        resolution: review.resolution,
        resolvedAtIso: review.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  async archive(id: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireClientWriter(authorization);
    if (!reason.trim()) throw new BadRequestException("Archive reason is required");
    const active = await this.prisma.customer.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: null, mergedIntoCustomerId: null },
      select: { id: true },
    });
    if (!active) throw new NotFoundException("Active Client not found");
    const archivedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { archivedAt, archivedByUserId: actor.id, archiveReason: reason.trim() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "client",
          entityId: id,
          action: "archived",
          newValue: { reason: reason.trim(), archivedAt: archivedAt.toISOString() },
          description: "Client archived",
        },
      });
    });
    return { id, archivedAtIso: archivedAt.toISOString() };
  }

  async merge(
    primaryClientId: string,
    secondaryClientId: string,
    reason: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireMergeAuthority(authorization);
    if (primaryClientId === secondaryClientId) {
      throw new BadRequestException("Primary and secondary Clients must be different");
    }
    if (!reason.trim()) throw new BadRequestException("Merge reason is required");

    const merged = await this.prisma.$transaction(async (tx) => {
      const [primary, secondary] = await Promise.all([
        tx.customer.findFirst({
          where: {
            id: primaryClientId,
            organizationId: actor.organizationId,
            archivedAt: null,
            mergedIntoCustomerId: null,
          },
          select: { ...this.clientSelect, dentalChart: true },
        }),
        tx.customer.findFirst({
          where: {
            id: secondaryClientId,
            organizationId: actor.organizationId,
            archivedAt: null,
            mergedIntoCustomerId: null,
          },
          select: { ...this.clientSelect, dentalChart: true },
        }),
      ]);
      if (!primary || !secondary) throw new NotFoundException("Both active Clients are required for merge");

      const [
        appointments,
        records,
        followUps,
        communications,
        invoices,
        payments,
        revisions,
        primaryPhones,
        secondaryPhones,
      ] = await Promise.all([
        tx.appointment.count({ where: { customerId: secondary.id } }),
        tx.appointmentSession.count({ where: { customerId: secondary.id } }),
        tx.followUpTask.count({ where: { customerId: secondary.id } }),
        tx.communicationLog.count({ where: { customerId: secondary.id } }),
        tx.invoice.count({ where: { customerId: secondary.id } }),
        tx.payment.count({ where: { customerId: secondary.id } }),
        tx.dentalChartRevision.count({ where: { customerId: secondary.id } }),
        tx.clientPhone.findMany({
          where: { customerId: primary.id, archivedAt: null },
          select: { id: true, normalizedValue: true, isPrimary: true },
        }),
        tx.clientPhone.findMany({
          where: { customerId: secondary.id, archivedAt: null },
          select: { id: true, normalizedValue: true, isPrimary: true },
        }),
      ]);
      const mergedAt = new Date();
      const primaryPhoneValues = new Set(primaryPhones.map((phone) => phone.normalizedValue));
      let phonesTransferred = 0;
      let duplicatePhonesArchived = 0;
      for (const phone of secondaryPhones) {
        if (primaryPhoneValues.has(phone.normalizedValue)) {
          await tx.clientPhone.update({
            where: { id: phone.id },
            data: {
              archivedAt: mergedAt,
              archivedByUserId: actor.id,
              archiveReason: `duplicate_during_merge_into:${primary.id}`,
              isPrimary: false,
            },
          });
          duplicatePhonesArchived += 1;
          continue;
        }
        await tx.clientPhone.update({
          where: { id: phone.id },
          data: { customerId: primary.id, isPrimary: false },
        });
        primaryPhoneValues.add(phone.normalizedValue);
        phonesTransferred += 1;
      }
      const relationshipCounts = {
        appointments,
        records,
        followUps,
        communications,
        invoices,
        payments,
        chartRevisions: revisions,
        phonesTransferred,
        duplicatePhonesArchived,
      };

      await Promise.all([
        tx.appointment.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.appointmentSession.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.followUpTask.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.communicationLog.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.invoice.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.payment.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
        tx.dentalChartRevision.updateMany({ where: { customerId: secondary.id }, data: { customerId: primary.id } }),
      ]);

      if (secondary.dentalChart && primary.dentalChart) {
        await tx.dentalChartRevision.create({
          data: {
            customerId: primary.id,
            chartData: secondary.dentalChart.chartData as Prisma.InputJsonValue,
            note: `Client merge preserved chart snapshot from ${secondary.patientCode ?? secondary.id}`,
          },
        });
      } else if (secondary.dentalChart) {
        await tx.patientDentalChart.create({
          data: {
            customerId: primary.id,
            chartData: secondary.dentalChart.chartData as Prisma.InputJsonValue,
            version: secondary.dentalChart.version,
          },
        });
      }

      await tx.customer.update({
        where: { id: secondary.id },
        data: {
          archivedAt: mergedAt,
          archivedByUserId: actor.id,
          archiveReason: `merged_into:${primary.id}`,
          mergedIntoCustomerId: primary.id,
        },
      });
      await tx.clientIdentityReview.updateMany({
        where: {
          organizationId: actor.organizationId,
          customerId: secondary.id,
          status: { in: ["Pending", "InReview"] },
          archivedAt: null,
        },
        data: { customerId: primary.id, version: { increment: 1 } },
      });
      if (secondary.patientCode) {
        await tx.clientAlias.create({
          data: {
            organizationId: actor.organizationId,
            customerId: primary.id,
            type: "merged_client_code",
            value: secondary.patientCode,
          },
        });
      }
      await tx.clientMerge.create({
        data: {
          organizationId: actor.organizationId,
          primaryCustomerId: primary.id,
          secondaryCustomerId: secondary.id,
          actorUserId: actor.id,
          reason: reason.trim(),
          relationshipCounts,
          fieldResolution: {
            primaryClientCode: primary.patientCode,
            secondaryClientCode: secondary.patientCode,
            preservedSecondaryChart: Boolean(secondary.dentalChart),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "client",
          entityId: primary.id,
          action: "merged",
          oldValue: { secondaryClientId: secondary.id, relationshipCounts },
          newValue: { secondaryArchivedAt: mergedAt.toISOString(), reason: reason.trim() },
          description: "Client merge completed; secondary Client archived and linked",
        },
      });
      return tx.customer.findUniqueOrThrow({ where: { id: primary.id }, select: this.clientSelect });
    });

    return this.mapClient(merged);
  }

  private get clientSelect() {
    return {
      id: true,
      organizationId: true,
      fullName: true,
      patientCode: true,
      phone: true,
      email: true,
      gender: true,
      dateOfBirth: true,
      address: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      allergies: true,
      medicalNotes: true,
      riskLabel: true,
      lastVisitAt: true,
      archivedAt: true,
      mergedIntoCustomerId: true,
      createdAt: true,
      updatedAt: true,
      phones: {
        where: { archivedAt: null },
        select: {
          id: true,
          rawValue: true,
          normalizedValue: true,
          type: true,
          label: true,
          isPrimary: true,
          verificationStatus: true,
          createdAt: true,
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    } satisfies Prisma.CustomerSelect;
  }

  private get directorySelect() {
    return {
      id: true,
      fullName: true,
      patientCode: true,
      phone: true,
      email: true,
      riskLabel: true,
      lastVisitAt: true,
      updatedAt: true,
      phones: {
        where: { archivedAt: null },
        select: {
          id: true,
          rawValue: true,
          type: true,
          label: true,
          isPrimary: true,
          verificationStatus: true,
          createdAt: true,
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    } satisfies Prisma.CustomerSelect;
  }

  private get phoneSelect() {
    return {
      id: true,
      rawValue: true,
      type: true,
      label: true,
      isPrimary: true,
      verificationStatus: true,
      normalizedValue: true,
      createdAt: true,
    } satisfies Prisma.ClientPhoneSelect;
  }

  private async findMatches(
    organizationId: string,
    candidate: Pick<MatchClientsDto, "name" | "phone" | "email" | "dateOfBirthIso">,
  ) {
    return (await this.findMatchesWithEvidence(organizationId, candidate))
      .map(({ score: _score, ...match }) => match);
  }

  private async findMatchesWithEvidence(
    organizationId: string,
    candidate: Pick<MatchClientsDto, "name" | "phone" | "email" | "dateOfBirthIso">,
  ) {
    const normalizedPhone = normalizeClientPhone(candidate.phone);
    const normalizedEmail = this.normalizeEmail(candidate.email);
    const normalizedName = this.normalizeName(candidate.name);
    const baseWhere = {
      organizationId,
      archivedAt: null,
      mergedIntoCustomerId: null,
    } satisfies Prisma.CustomerWhereInput;
    const phoneRows = normalizedPhone
      ? await this.prisma.customer.findMany({
          where: {
            ...baseWhere,
            OR: [
              { normalizedPhone },
              { phones: { some: { normalizedValue: normalizedPhone, archivedAt: null } } },
            ],
          },
          select: this.clientSelect,
          take: 6,
        })
      : [];
    const phoneIds = phoneRows.map((row) => row.id);
    const emailRows = normalizedEmail && phoneRows.length < 6
      ? await this.prisma.customer.findMany({
          where: {
            ...baseWhere,
            id: { notIn: phoneIds },
            normalizedEmail,
          },
          select: this.clientSelect,
          take: 6 - phoneRows.length,
        })
      : [];
    const contactIds = [...phoneIds, ...emailRows.map((row) => row.id)];
    const nameRows = normalizedName && contactIds.length < 6
      ? await this.prisma.customer.findMany({
          where: {
            ...baseWhere,
            id: { notIn: contactIds },
            fullName: { equals: candidate.name.trim(), mode: "insensitive" },
          },
          select: this.clientSelect,
          take: 6 - contactIds.length,
        })
      : [];
    const rows = [...phoneRows, ...emailRows, ...nameRows];

    return rows
      .map((row) => {
        let score = 0;
        const phoneMatched = Boolean(
          normalizedPhone &&
          (normalizeClientPhone(row.phone) === normalizedPhone ||
            row.phones.some((phone) => phone.normalizedValue === normalizedPhone)),
        );
        const emailMatched = Boolean(
          normalizedEmail && this.normalizeEmail(row.email) === normalizedEmail,
        );
        const nameMatched = this.normalizeName(row.fullName) === normalizedName;
        const dateOfBirthMatched = Boolean(
          candidate.dateOfBirthIso &&
          row.dateOfBirth?.toISOString().slice(0, 10) === candidate.dateOfBirthIso.slice(0, 10),
        );
        if (phoneMatched) score += 100;
        if (emailMatched) score += 40;
        if (nameMatched) score += 35;
        if (dateOfBirthMatched) score += 25;
        const corroboratingIdentity = emailMatched || nameMatched || dateOfBirthMatched;
        const confidence =
          phoneMatched && corroboratingIdentity
            ? "strong"
            : score >= 45 && !phoneMatched
              ? "moderate"
              : "weak";
        return {
          score,
          confidence,
          matchedOn: [
            ...(phoneMatched ? ["phone"] : []),
            ...(emailMatched ? ["email"] : []),
            ...(nameMatched ? ["name"] : []),
            ...(dateOfBirthMatched ? ["date_of_birth"] : []),
          ],
          client: this.mapDirectoryClient(row),
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }

  private async allocateClientCode(tx: Prisma.TransactionClient, organizationId: string) {
    const sequence = await tx.clientCodeSequence.upsert({
      where: { organizationId },
      create: { organizationId, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
    });
    return `CL-${String(sequence.nextValue - 1).padStart(6, "0")}`;
  }

  private async syncPrimaryPhone(
    tx: Prisma.TransactionClient,
    customerId: string,
    organizationId: string,
    rawValue: string,
    actorId: string,
    source: string,
  ) {
    const normalizedValue = this.assertValidPhone(rawValue);
    const target = await tx.clientPhone.findFirst({
      where: { customerId, normalizedValue, archivedAt: null },
      select: { id: true, isPrimary: true },
    });
    if (target) {
      if (!target.isPrimary) {
        await tx.clientPhone.updateMany({
          where: { customerId, archivedAt: null, isPrimary: true, id: { not: target.id } },
          data: { isPrimary: false },
        });
      }
      await tx.clientPhone.update({
        where: { id: target.id },
        data: {
          rawValue: rawValue.trim(),
          isPrimary: true,
          normalizationVersion: phoneNormalizationVersion,
          sourceMetadata: { reason: "administrative_profile_correction" },
        },
      });
      return;
    }
    const currentPrimary = await tx.clientPhone.findFirst({
      where: { customerId, archivedAt: null, isPrimary: true },
      select: { id: true },
    });
    if (currentPrimary) {
      await tx.clientPhone.update({
        where: { id: currentPrimary.id },
        data: { isPrimary: false },
      });
    }
    await tx.clientPhone.create({
      data: {
        organizationId,
        customerId,
        rawValue: rawValue.trim(),
        normalizedValue,
        normalizationVersion: phoneNormalizationVersion,
        type: "Mobile",
        isPrimary: true,
        source,
        createdByUserId: actorId,
      },
    });
  }

  private mapClient(client: {
    id: string;
    fullName: string;
    patientCode: string | null;
    phone: string;
    email: string | null;
    gender: string | null;
    dateOfBirth: Date | null;
    address: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    allergies: string | null;
    medicalNotes: string | null;
    riskLabel: string;
    lastVisitAt: Date | null;
    archivedAt: Date | null;
    mergedIntoCustomerId: string | null;
    createdAt: Date;
    updatedAt: Date;
    phones?: Array<{
      id: string;
      rawValue: string;
      type: string;
      label: string | null;
      isPrimary: boolean;
      verificationStatus: string;
      createdAt: Date;
    }>;
  }) {
    return {
      id: client.id,
      clientCode: client.patientCode,
      name: client.fullName,
      phone: client.phone,
      phoneSummaries: client.phones?.map((phone) => this.mapPhone(phone)) ?? [],
      email: client.email,
      gender: client.gender,
      dateOfBirthIso: client.dateOfBirth?.toISOString() ?? null,
      address: client.address,
      emergencyContactName: client.emergencyContactName,
      emergencyContactPhone: client.emergencyContactPhone,
      allergies: client.allergies,
      medicalNotes: client.medicalNotes,
      risk: client.riskLabel,
      lastVisitIso: (client.lastVisitAt ?? client.updatedAt).toISOString(),
      archivedAtIso: client.archivedAt?.toISOString() ?? null,
      mergedIntoClientId: client.mergedIntoCustomerId,
      createdAtIso: client.createdAt.toISOString(),
      updatedAtIso: client.updatedAt.toISOString(),
    };
  }

  private mapDirectoryClient(client: {
    id: string;
    fullName: string;
    patientCode: string | null;
    phone: string;
    email: string | null;
    riskLabel: string;
    lastVisitAt: Date | null;
    updatedAt: Date;
    phones?: Array<{
      id: string;
      rawValue: string;
      type: string;
      label: string | null;
      isPrimary: boolean;
      verificationStatus: string;
      createdAt: Date;
    }>;
  }) {
    return {
      id: client.id,
      clientCode: client.patientCode,
      name: client.fullName,
      phone: client.phone,
      phoneSummaries: client.phones?.map((phone) => this.mapPhone(phone)) ?? [],
      email: client.email,
      risk: client.riskLabel,
      lastVisitIso: (client.lastVisitAt ?? client.updatedAt).toISOString(),
    };
  }

  private searchWhere(search: string): Prisma.CustomerWhereInput[] {
    const phone = normalizeClientPhone(search);
    const email = this.normalizeEmail(search);
    return [
      { patientCode: { startsWith: search.toUpperCase() } },
      ...(phone
        ? [
            { normalizedPhone: { startsWith: phone } },
            { phones: { some: { normalizedValue: { startsWith: phone }, archivedAt: null } } },
          ]
        : []),
      ...(email ? [{ normalizedEmail: { startsWith: email } }] : []),
      { fullName: { contains: search, mode: "insensitive" } },
    ];
  }

  private assertClientIdentity(
    dto: Pick<
      ClientIdentityDto,
      "name" | "phone" | "dateOfBirthIso" | "emergencyContactPhone"
    >,
  ) {
    if (!dto.name.trim()) throw new BadRequestException("Client name is required");
    this.assertValidPhone(dto.phone);
    if (dto.emergencyContactPhone?.trim()) {
      this.assertValidPhone(dto.emergencyContactPhone);
    }
    if (dto.dateOfBirthIso) {
      if (
        !isValidAdDateKey(dto.dateOfBirthIso) ||
        dto.dateOfBirthIso > adDateKeyInTimeZone(new Date())
      ) {
        throw new BadRequestException(
          "Date of birth must be a real AD date that is not in the future",
        );
      }
    }
  }

  private safeIdentityAudit(dto: ClientIdentityDto) {
    return {
      name: dto.name.trim(),
      phoneProvided: Boolean(normalizeClientPhone(dto.phone)),
      emailProvided: Boolean(this.normalizeEmail(dto.email)),
      dateOfBirthProvided: Boolean(dto.dateOfBirthIso),
      risk: dto.risk,
    };
  }

  private safeClientAudit(client: { fullName: string; phone: string; email: string | null; riskLabel: string }) {
    return {
      name: client.fullName,
      phoneProvided: Boolean(normalizeClientPhone(client.phone)),
      emailProvided: Boolean(this.normalizeEmail(client.email)),
      risk: client.riskLabel,
    };
  }

  private assertValidPhone(value?: string | null) {
    const normalized = normalizeClientPhone(value);
    if (normalized.length < 7 || normalized.length > 15) {
      throw new BadRequestException("Phone number must contain 7 to 15 digits");
    }
    return normalized;
  }

  private normalizeEmail(value?: string | null) {
    return value?.trim().toLowerCase() || null;
  }

  private normalizeName(value: string) {
    return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  }

  private blankToNull(value?: string) {
    return value?.trim() || null;
  }

  private clientCreateRequestHash(dto: CreateClientDto) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          name: this.normalizeName(dto.name),
          phone: normalizeClientPhone(dto.phone),
          email: this.normalizeEmail(dto.email),
          gender: this.blankToNull(dto.gender),
          dateOfBirthIso: dto.dateOfBirthIso ?? null,
          address: this.blankToNull(dto.address),
          emergencyContactName: this.blankToNull(dto.emergencyContactName),
          emergencyContactPhone: normalizeClientPhone(
            dto.emergencyContactPhone,
          ),
          allergies: this.blankToNull(dto.allergies),
          medicalNotes: this.blankToNull(dto.medicalNotes),
          risk: dto.risk,
          priorVisitedClinic: Boolean(dto.priorVisitedClinic),
          duplicateCheckAcknowledged: Boolean(
            dto.duplicateCheckAcknowledged,
          ),
          candidateSetVersion: dto.candidateSetVersion,
          skippedPossibleMatchClientIds: [
            ...(dto.skippedPossibleMatchClientIds ?? []),
          ].sort(),
        }),
      )
      .digest("hex");
  }

  private replayClientCreation(
    storedHash: string,
    requestHash: string,
    response: Prisma.JsonValue,
    customer: ClientCreationReplayCustomer,
  ): ClientCreationResponse {
    if (storedHash !== requestHash) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "This idempotency key was already used for another Client.",
      });
    }
    const stored = response as unknown as Partial<ClientCreationResponse>;
    return {
      ...stored,
      id: customer.id,
      clientCode: customer.patientCode,
      name: customer.fullName,
      phone: customer.phone,
      identityReview: stored.identityReview ?? null,
      replayed: true,
    };
  }

  private isSerializationFailure(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    );
  }

  private mapPhone(phone: {
    id: string;
    rawValue: string;
    type: string;
    label: string | null;
    isPrimary: boolean;
    verificationStatus: string;
    createdAt: Date;
  }) {
    return {
      id: phone.id,
      displayValue: phone.rawValue,
      type: phone.type,
      label: phone.label,
      isPrimary: phone.isPrimary,
      verificationStatus: phone.verificationStatus,
      createdAtIso: phone.createdAt.toISOString(),
    };
  }

  private async requireOperator(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    return actor;
  }

  private async requireClientWriter(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, clientIdentityWriteRoles)) {
      throw new ForbiddenException("You are not allowed to create or change Client identity");
    }
    return actor;
  }

  private async requireClientCreator(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, clientIdentityCreateRoles)) {
      throw new ForbiddenException("You are not allowed to create Client identity");
    }
    return actor;
  }

  private async requireClientPhoneAppender(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, clientPhoneAppendRoles)) {
      throw new ForbiddenException("You are not allowed to add a Client phone");
    }
    return actor;
  }

  private async requireIdentityReviewer(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, identityReviewRoles)) {
      throw new ForbiddenException("Only an Owner, Admin, or Manager can resolve Client identity reviews");
    }
    return actor;
  }

  private async requireMergeAuthority(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.requireOperator(authorization);
    const roles = actor.effectiveRoles ?? [actor.role as UserRole];
    if (!roles.includes("Owner") && !roles.includes("Admin")) {
      throw new ForbiddenException("Only an Owner or Admin can merge Clients");
    }
    return actor;
  }
}

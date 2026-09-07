import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { getNepalAdDateKeyFromIso } from "../../lib/nepal-time";
import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import {
  assertBookingActor,
  clientIdentityCreateRoles,
  clientPhoneAppendRoles,
  hasAnyRole,
} from "../auth/authz";
import {
  normalizeClientPhone,
} from "../customers/client-phone-normalization";
import {
  buildClientCandidateSetVersion,
  clientPhoneNormalizationVersion,
} from "../customers/client-match-version";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import type {
  BookingConfirmationClientDto,
  ConfirmBookingDto,
} from "./dto/booking-confirmation.dto";

const PHONE_NORMALIZATION_VERSION = clientPhoneNormalizationVersion;
const MAX_SERIALIZATION_ATTEMPTS = 3;

type ConfirmationResponse = {
  confirmationId: string;
  appointment: {
    id: string;
    status: "Scheduled";
    startsAtIso: string;
    endsAtIso: string;
    durationMinutes: number;
    bufferMinutes: number;
    priority: "Low" | "Normal" | "High" | "Urgent";
  };
  client: {
    id: string;
    name: string;
    clientCode: string | null;
    created: boolean;
    phoneAppended: boolean;
    identityReviewCreated: boolean;
  };
  hold: { id: string; status: "consumed" } | null;
  replayed: boolean;
};

@Injectable()
export class BookingConfirmationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SchedulingService)
    private readonly scheduling: SchedulingService,
  ) {}

  async confirm(
    dto: ConfirmBookingDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ): Promise<ConfirmationResponse> {
    const actor = await this.auth.requireSession(authorization);
    assertBookingActor(actor, dto.locationId, dto.providerId);
    this.assertConfirmation(dto);
    const requestHash = this.requestHash(dto);

    const replay = await this.findReplay(
      actor.organizationId,
      actor.id,
      idempotencyKey,
    );
    if (replay) {
      return this.replayResponse(replay.requestHash, requestHash, replay.response);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          (tx) =>
            this.confirmTransaction(
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
        this.scheduling.invalidateAppointmentPlanning({
          organizationId: actor.organizationId,
          providerIds: [dto.providerId],
          dateKeys: [getNepalAdDateKeyFromIso(dto.startsAtIso)],
          locationId: dto.locationId,
        });
        return result;
      } catch (error) {
        lastError = error;
        if (this.isReceiptUniqueConflict(error)) {
          const winner = await this.findReplay(
            actor.organizationId,
            actor.id,
            idempotencyKey,
          );
          if (winner) {
            return this.replayResponse(
              winner.requestHash,
              requestHash,
              winner.response,
            );
          }
        }
        if (this.isProviderOverlap(error)) {
          throw this.conflict(
            "SLOT_UNAVAILABLE",
            "That time is no longer available.",
          );
        }
        if (!this.isSerializationFailure(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private async confirmTransaction(
    tx: Prisma.TransactionClient,
    dto: ConfirmBookingDto,
    idempotencyKey: string,
    requestHash: string,
    actor: AuthSession,
  ): Promise<ConfirmationResponse> {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`${actor.organizationId}:${actor.id}:${idempotencyKey}`},
          0
        )
      )
    `);
    const existing = await tx.bookingConfirmation.findUnique({
      where: {
        organizationId_actorUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          idempotencyKey,
        },
      },
      select: { requestHash: true, response: true },
    });
    if (existing) {
      return this.replayResponse(
        existing.requestHash,
        requestHash,
        existing.response,
      );
    }

    await this.lockProvider(tx, actor.organizationId, dto.providerId);
    const now = await this.databaseNow(tx);
    const startsAt = new Date(dto.startsAtIso);
    const horizon = new Date(now);
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 1);
    if (startsAt <= now || startsAt > horizon) {
      throw this.conflict(
        "SLOT_UNAVAILABLE",
        "The selected time is outside the booking horizon.",
      );
    }

    const location = await tx.location.findFirst({
      where: {
        id: dto.locationId,
        organizationId: actor.organizationId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!location) {
      throw new ForbiddenException({
        code: "BOOKING_NOT_ALLOWED",
        message: "The selected clinic location is unavailable.",
      });
    }

    const timing = await this.resolveEffectiveTiming(tx, dto, actor);
    const endsAt = new Date(
      startsAt.getTime() + timing.durationMinutes * 60_000,
    );
    const reservedEndsAt = new Date(
      endsAt.getTime() + timing.bufferMinutes * 60_000,
    );

    const hold = dto.holdId
      ? await this.lockAndValidateHold(
          tx,
          dto,
          actor,
          now,
          endsAt,
          timing.bufferMinutes,
        )
      : null;
    await this.assertNoCompetingHold(
      tx,
      actor.organizationId,
      dto.providerId,
      startsAt,
      reservedEndsAt,
      now,
      hold?.id,
    );
    const client = await this.resolveClient(tx, dto.client, actor);
    const appointment = await tx.appointment.create({
      data: {
        organizationId: actor.organizationId,
        locationId: dto.locationId,
        customerId: client.id,
        providerId: dto.providerId,
        startsAt,
        endsAt,
        durationMinutes: timing.durationMinutes,
        bufferMinutes: timing.bufferMinutes,
        priority: dto.priority,
        status: "Scheduled",
        communicationState: "Unconfirmed",
        notes: dto.notes?.trim() || null,
        services: { create: [{ serviceId: dto.serviceId }] },
      },
      select: { id: true },
    });
    await tx.workflowEvent.create({
      data: {
        organizationId: actor.organizationId,
        appointmentId: appointment.id,
        fromStatus: null,
        toStatus: "Scheduled",
        actorUserId: actor.id,
        note: "Atomic guided booking confirmation",
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "appointment",
        entityId: appointment.id,
        action: "created",
        newValue: {
          source: "guided_booking_confirmation",
          locationId: dto.locationId,
          providerId: dto.providerId,
          serviceId: dto.serviceId,
          customerId: client.id,
          startsAtIso: startsAt.toISOString(),
          durationMinutes: timing.durationMinutes,
          bufferMinutes: timing.bufferMinutes,
          priority: dto.priority,
          holdId: hold?.id ?? null,
        },
        description: "Appointment created atomically from guided booking",
      },
    });

    if (hold) {
      const consumed = await tx.bookingSlotHold.updateMany({
        where: {
          id: hold.id,
          releasedAt: null,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw this.conflict(
          "HOLD_EXPIRED",
          "The selected slot hold expired before confirmation.",
        );
      }
    }

    const confirmationId = randomUUID();
    const response: ConfirmationResponse = {
      confirmationId,
      appointment: {
        id: appointment.id,
        status: "Scheduled",
        startsAtIso: startsAt.toISOString(),
        endsAtIso: endsAt.toISOString(),
        durationMinutes: timing.durationMinutes,
        bufferMinutes: timing.bufferMinutes,
        priority: dto.priority,
      },
      client: {
        id: client.id,
        name: client.name,
        clientCode: client.clientCode,
        created: client.created,
        phoneAppended: client.phoneAppended,
        identityReviewCreated: client.identityReviewCreated,
      },
      hold: hold ? { id: hold.id, status: "consumed" } : null,
      replayed: false,
    };
    await tx.bookingConfirmation.create({
      data: {
        id: confirmationId,
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        idempotencyKey,
        draftId: dto.draftId,
        requestHash,
        appointmentId: appointment.id,
        customerId: client.id,
        holdId: hold?.id,
        response: response as unknown as Prisma.InputJsonObject,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "booking_confirmation",
        entityId: confirmationId,
        action: "completed",
        newValue: {
          appointmentId: appointment.id,
          customerId: client.id,
          holdId: hold?.id ?? null,
          replaySafe: true,
        },
        description: "Atomic booking confirmation completed",
      },
    });
    return response;
  }

  private async resolveClient(
    tx: Prisma.TransactionClient,
    input: BookingConfirmationClientDto,
    actor: AuthSession,
  ) {
    if (input.mode === "existing") {
      if (!input.clientId) {
        throw new BadRequestException({
          code: "INVALID_CONFIRMATION",
          message: "An existing Client selection is required.",
        });
      }
      const existing = await tx.customer.findFirst({
        where: {
          id: input.clientId,
          organizationId: actor.organizationId,
          archivedAt: null,
          mergedIntoCustomerId: null,
        },
        select: {
          id: true,
          fullName: true,
          patientCode: true,
          phone: true,
          phones: {
            where: { archivedAt: null },
            select: { normalizedValue: true },
          },
        },
      });
      if (!existing) {
        throw this.conflict(
          "CLIENT_UNAVAILABLE",
          "The selected Client is unavailable.",
        );
      }
      let phoneAppended = false;
      if (input.phone?.trim()) {
        const normalized = this.validPhone(input.phone);
        const alreadyKnown =
          normalizeClientPhone(existing.phone) === normalized ||
          existing.phones.some(
            (phone) => phone.normalizedValue === normalized,
          );
        if (!alreadyKnown) {
          this.assertClientPhoneAppender(actor);
          const phoneId = randomUUID();
          const inserted = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
              INSERT INTO "ClientPhone" (
                "id", "organizationId", "customerId", "rawValue",
                "normalizedValue", "normalizationVersion", "type",
                "isPrimary", "source", "sourceMetadata",
                "createdByUserId", "updatedAt"
              )
              VALUES (
                ${phoneId}, ${actor.organizationId}, ${existing.id},
                ${input.phone.trim()}, ${normalized},
                ${PHONE_NORMALIZATION_VERSION}, 'Mobile', false,
                'BookingSelection',
                CAST(${JSON.stringify({
                  reason: "booking_identity_selection",
                })} AS jsonb),
                ${actor.id}, CURRENT_TIMESTAMP
              )
              ON CONFLICT ("customerId", "normalizedValue")
                WHERE "archivedAt" IS NULL
              DO NOTHING
              RETURNING "id"
            `,
          );
          phoneAppended = inserted.length === 1;
          if (phoneAppended) {
            await tx.auditLog.create({
              data: {
                organizationId: actor.organizationId,
                actorId: actor.id,
                entityType: "client_phone",
                entityId: phoneId,
                action: "added",
                newValue: {
                  clientId: existing.id,
                  last4: normalized.slice(-4),
                  source: "booking_confirmation",
                },
                description:
                  "Secondary Client phone added during booking",
              },
            });
          }
        }
      }
      return {
        id: existing.id,
        name: existing.fullName,
        clientCode: existing.patientCode,
        created: false,
        phoneAppended,
        identityReviewCreated: false,
      };
    }

    this.assertClientCreator(actor);
    const name = input.name?.trim() ?? "";
    if (!name) {
      throw new BadRequestException({
        code: "INVALID_CONFIRMATION",
        message: "Client name is required.",
      });
    }
    const normalizedPhone = this.validPhone(input.phone);
    const candidateSelect = {
      id: true,
      fullName: true,
      updatedAt: true,
      normalizedPhone: true,
      phones: {
        where: { archivedAt: null },
        select: {
          id: true,
          normalizedValue: true,
          updatedAt: true,
        },
      },
    } satisfies Prisma.CustomerSelect;
    const exactCandidates = await tx.customer.findMany({
      where: {
        organizationId: actor.organizationId,
        archivedAt: null,
        mergedIntoCustomerId: null,
        OR: [
          { normalizedPhone },
          {
            phones: {
              some: { normalizedValue: normalizedPhone, archivedAt: null },
            },
          },
        ],
      },
      select: candidateSelect,
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
    });
    const nameCandidates =
      exactCandidates.length < 6
        ? await tx.customer.findMany({
            where: {
              organizationId: actor.organizationId,
              archivedAt: null,
              mergedIntoCustomerId: null,
              id: {
                notIn: exactCandidates.map((candidate) => candidate.id),
              },
              fullName: { equals: name, mode: "insensitive" },
            },
            select: candidateSelect,
            orderBy: [{ updatedAt: "desc" }],
            take: 6 - exactCandidates.length,
          })
        : [];
    const candidates = [...exactCandidates, ...nameCandidates];
    const candidateVersion = buildClientCandidateSetVersion(
      normalizedPhone,
      candidates,
    );
    if (input.candidateSetVersion !== candidateVersion) {
      throw this.conflict(
        "IDENTITY_MATCH_CHANGED",
        "Possible Client matches changed. Review them again.",
      );
    }
    if (candidates.length && !input.duplicateCheckAcknowledged) {
      throw this.conflict(
        "MATCH_REVIEW_REQUIRED",
        "Potential matching Clients require explicit review.",
      );
    }

    const sequence = await tx.clientCodeSequence.upsert({
      where: { organizationId: actor.organizationId },
      create: { organizationId: actor.organizationId, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
    });
    const clientCode = `CL-${String(sequence.nextValue - 1).padStart(6, "0")}`;
    const created = await tx.customer.create({
      data: {
        organizationId: actor.organizationId,
        fullName: name,
        patientCode: clientCode,
        phone: input.phone!.trim(),
        normalizedPhone,
        address: input.address?.trim() || null,
        riskLabel: "Routine",
        dentalChart: {
          create: {
            chartData: { segments: [], notes: [], version: 1 },
            version: 1,
          },
        },
      },
      select: { id: true, fullName: true, patientCode: true },
    });
    await tx.clientPhone.create({
      data: {
        organizationId: actor.organizationId,
        customerId: created.id,
        rawValue: input.phone!.trim(),
        normalizedValue: normalizedPhone,
        normalizationVersion: PHONE_NORMALIZATION_VERSION,
        type: "Mobile",
        isPrimary: true,
        source: "BookingCreate",
        createdByUserId: actor.id,
      },
    });
    const candidateIds = new Set(
      candidates.map((candidate) => candidate.id),
    );
    const validatedSkippedIds = (
      input.skippedPossibleMatchClientIds ?? []
    ).filter((id) => candidateIds.has(id));
    const reviewRequired =
      Boolean(input.priorVisitedClinic) ||
      validatedSkippedIds.length > 0 ||
      candidates.length > 0;
    if (reviewRequired) {
      await tx.clientIdentityReview.create({
        data: {
          organizationId: actor.organizationId,
          customerId: created.id,
          reason: input.priorVisitedClinic
            ? "PriorVisitClaim"
            : "SkippedPossibleMatches",
          candidateSnapshot: candidates.map((candidate) => ({
            customerId: candidate.id,
            score:
              candidate.normalizedPhone === normalizedPhone ||
              candidate.phones.some(
                (phone) => phone.normalizedValue === normalizedPhone,
              )
                ? 100
                : 35,
            confidence:
              candidate.normalizedPhone === normalizedPhone ||
              candidate.phones.some(
                (phone) => phone.normalizedValue === normalizedPhone,
              )
                ? "strong"
                : "weak",
            matchedOn:
              candidate.normalizedPhone === normalizedPhone ||
              candidate.phones.some(
                (phone) => phone.normalizedValue === normalizedPhone,
              )
                ? ["phone"]
                : ["name"],
          })),
          context: {
            source: "booking_confirmation",
            candidateSetVersion: candidateVersion,
            skippedPossibleMatchClientIds:
              validatedSkippedIds,
            priorVisitedClinic: Boolean(input.priorVisitedClinic),
          },
          createdByUserId: actor.id,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "client",
        entityId: created.id,
        action: "created",
        newValue: {
          clientCode,
          source: "booking_confirmation",
          phoneProvided: true,
          duplicateCheckAcknowledged: Boolean(
            input.duplicateCheckAcknowledged,
          ),
          identityReviewCreated: reviewRequired,
        },
        description: "Client created atomically during booking",
      },
    });
    return {
      id: created.id,
      name: created.fullName,
      clientCode: created.patientCode,
      created: true,
      phoneAppended: false,
      identityReviewCreated: reviewRequired,
    };
  }

  private async lockAndValidateHold(
    tx: Prisma.TransactionClient,
    dto: ConfirmBookingDto,
    actor: AuthSession,
    now: Date,
    endsAt: Date,
    bufferMinutes: number,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        draftId: string;
        organizationId: string;
        createdByUserId: string;
        locationId: string;
        providerId: string;
        serviceId: string;
        startsAt: Date;
        endsAt: Date;
        bufferMinutes: number;
        expiresAt: Date;
        releasedAt: Date | null;
        consumedAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        "id", "draftId", "organizationId", "createdByUserId",
        "locationId", "providerId", "serviceId", "startsAt", "endsAt",
        "bufferMinutes", "expiresAt", "releasedAt", "consumedAt"
      FROM "BookingSlotHold"
      WHERE "id" = ${dto.holdId}
      FOR UPDATE
    `);
    const hold = rows[0];
    if (!hold) {
      throw this.conflict("HOLD_EXPIRED", "The selected hold is unavailable.");
    }
    if (hold.releasedAt) {
      throw this.conflict("HOLD_RELEASED", "The selected hold was released.");
    }
    if (hold.consumedAt) {
      throw this.conflict("HOLD_CONSUMED", "The selected hold was already used.");
    }
    if (hold.expiresAt <= now) {
      throw this.conflict("HOLD_EXPIRED", "The selected hold expired.");
    }
    if (
      hold.organizationId !== actor.organizationId ||
      hold.createdByUserId !== actor.id ||
      hold.draftId !== dto.draftId ||
      hold.locationId !== dto.locationId ||
      hold.providerId !== dto.providerId ||
      hold.serviceId !== dto.serviceId ||
      hold.startsAt.getTime() !== new Date(dto.startsAtIso).getTime() ||
      hold.endsAt.getTime() !== endsAt.getTime() ||
      hold.bufferMinutes !== bufferMinutes
    ) {
      throw this.conflict(
        "HOLD_MISMATCH",
        "The selected hold does not match this booking.",
      );
    }
    return hold;
  }

  private async assertNoCompetingHold(
    tx: Prisma.TransactionClient,
    organizationId: string,
    providerId: string,
    startsAt: Date,
    reservedEndsAt: Date,
    now: Date,
    ownHoldId?: string,
  ) {
    const holds = await tx.bookingSlotHold.findMany({
      where: {
        organizationId,
        providerId,
        id: ownHoldId ? { not: ownHoldId } : undefined,
        releasedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
        startsAt: { lt: reservedEndsAt },
      },
      select: {
        startsAt: true,
        endsAt: true,
        bufferMinutes: true,
      },
    });
    if (
      holds.some(
        (hold) =>
          startsAt <
            new Date(
              hold.endsAt.getTime() + hold.bufferMinutes * 60_000,
            ) && hold.startsAt < reservedEndsAt,
      )
    ) {
      throw this.conflict(
        "SLOT_UNAVAILABLE",
        "That time is temporarily held by another booking.",
      );
    }
  }

  private async lockProvider(
    tx: Prisma.TransactionClient,
    organizationId: string,
    providerId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Provider"
      WHERE "id" = ${providerId}
        AND "organizationId" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw this.conflict(
        "SLOT_UNAVAILABLE",
        "The selected Provider is unavailable.",
      );
    }
  }

  private async databaseNow(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
    );
    return rows[0]?.now ?? new Date();
  }

  private async findReplay(
    organizationId: string,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.bookingConfirmation.findUnique({
      where: {
        organizationId_actorUserId_idempotencyKey: {
          organizationId,
          actorUserId,
          idempotencyKey,
        },
      },
      select: { requestHash: true, response: true },
    });
  }

  private replayResponse(
    storedHash: string,
    requestHash: string,
    response: Prisma.JsonValue,
  ) {
    if (storedHash !== requestHash) {
      throw this.conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for another booking.",
      );
    }
    return {
      ...(response as unknown as Omit<ConfirmationResponse, "replayed">),
      replayed: true,
    };
  }

  private requestHash(dto: ConfirmBookingDto) {
    const client =
      dto.client.mode === "existing"
        ? {
            mode: "existing",
            clientId: dto.client.clientId,
            phone: dto.client.phone
              ? normalizeClientPhone(dto.client.phone)
              : undefined,
          }
        : {
            mode: "new",
            name: dto.client.name?.trim(),
            phone: normalizeClientPhone(dto.client.phone),
            address: dto.client.address?.trim() || undefined,
            priorVisitedClinic: Boolean(dto.client.priorVisitedClinic),
            duplicateCheckAcknowledged: Boolean(
              dto.client.duplicateCheckAcknowledged,
            ),
            skippedPossibleMatchClientIds: [
              ...(dto.client.skippedPossibleMatchClientIds ?? []),
            ].sort(),
            candidateSetVersion: dto.client.candidateSetVersion,
          };
    return createHash("sha256")
      .update(
        JSON.stringify({
          draftId: dto.draftId,
          locationId: dto.locationId,
          providerId: dto.providerId,
          serviceId: dto.serviceId,
          startsAtIso: new Date(dto.startsAtIso).toISOString(),
          priority: dto.priority,
          notes: dto.notes?.trim() || undefined,
          holdId: dto.holdId,
          client,
        }),
      )
      .digest("hex");
  }

  private assertConfirmation(dto: ConfirmBookingDto) {
    if (!dto.client) {
      throw new BadRequestException({
        code: "INVALID_CONFIRMATION",
        message: "Client details are required.",
      });
    }
    if (dto.client.mode === "new" && !dto.client.phone) {
      throw new BadRequestException({
        code: "INVALID_CONFIRMATION",
        message: "Client phone is required.",
      });
    }
    if (
      dto.client.mode === "new" &&
      !dto.client.candidateSetVersion
    ) {
      throw new BadRequestException({
        code: "INVALID_CONFIRMATION",
        message: "Client match review version is required.",
      });
    }
  }

  private async resolveEffectiveTiming(
    tx: Prisma.TransactionClient,
    dto: ConfirmBookingDto,
    actor: AuthSession,
  ) {
    try {
      return await this.scheduling.getEffectiveSlotTiming(
        {
          organizationId: actor.organizationId,
          providerId: dto.providerId,
          locationId: dto.locationId,
          serviceId: dto.serviceId,
          startsAtIso: dto.startsAtIso,
        },
        tx,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw this.conflict(
          "AVAILABILITY_CHANGED",
          "Provider, service, or availability details changed. Choose a time again.",
        );
      }
      throw error;
    }
  }

  private validPhone(value?: string | null) {
    const normalized = normalizeClientPhone(value);
    if (normalized.length < 7 || normalized.length > 15) {
      throw new BadRequestException({
        code: "INVALID_CONFIRMATION",
        message: "Phone number must contain 7 to 15 digits.",
      });
    }
    return normalized;
  }

  private assertClientCreator(actor: AuthSession) {
    if (!hasAnyRole(actor, clientIdentityCreateRoles)) {
      throw new ForbiddenException({
        code: "CLIENT_WRITE_NOT_ALLOWED",
        message: "You are not allowed to create Client identity.",
      });
    }
  }

  private assertClientPhoneAppender(actor: AuthSession) {
    if (!hasAnyRole(actor, clientPhoneAppendRoles)) {
      throw new ForbiddenException({
        code: "CLIENT_WRITE_NOT_ALLOWED",
        message: "You are not allowed to add a Client phone.",
      });
    }
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private isProviderOverlap(error: unknown) {
    const value =
      error instanceof Error
        ? `${error.message}:${JSON.stringify(
            "meta" in error ? error.meta : {},
          )}`
        : error && typeof error === "object"
          ? JSON.stringify(error)
          : "";
    return (
      value.includes("Appointment_provider_time_no_overlap") ||
      value.includes("23P01")
    );
  }

  private isSerializationFailure(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    );
  }

  private isReceiptUniqueConflict(error: unknown) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      return false;
    }
    return JSON.stringify(error.meta ?? {}).includes(
      "idempotencyKey",
    );
  }
}

import { createHash } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  getNepalAdDateKeyFromIso,
  getNepalDayRangeFromDateKey,
} from "../../lib/nepal-time";
import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import { assertBookingActor } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import {
  type CreateBookingSlotHoldDto,
  type RankedAvailabilityQueryDto,
} from "./dto/booking-availability.dto";

const DEFAULT_HOLD_MINUTES = 3;
const MAX_RECOMMENDED_SLOTS = 5;
const MAX_ACTIVE_HOLDS_PER_USER = 3;

@Injectable()
export class BookingAvailabilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SchedulingService)
    private readonly scheduling: SchedulingService,
  ) {}

  async rankedAvailability(
    query: RankedAvailabilityQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    assertBookingActor(actor, query.locationId, query.providerId);
    const location = await this.assertLocation(
      actor.organizationId,
      query.locationId,
    );

    const result = await this.scheduling.listProviderSlots({
      organizationId: actor.organizationId,
      providerId: query.providerId,
      locationId: query.locationId,
      serviceId: query.serviceId,
      dateKey: query.date,
    });
    const now = await this.databaseNow(this.prisma);
    const dayRange = getNepalDayRangeFromDateKey(query.date);
    const holds = await this.prisma.bookingSlotHold.findMany({
      where: {
        organizationId: actor.organizationId,
        providerId: query.providerId,
        releasedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
        startsAt: {
          gte: new Date(dayRange.startsAt.getTime() - 24 * 60 * 60_000),
          lte: dayRange.endsAt,
        },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        bufferMinutes: true,
      },
    });

    const bookingHorizon = new Date(now);
    bookingHorizon.setUTCFullYear(bookingHorizon.getUTCFullYear() + 1);
    const available = result.slots.filter((slot) => {
      const startsAt = new Date(slot.startsAtIso);
      if (startsAt <= now || startsAt > bookingHorizon) return false;
      const endsAt = new Date(
        startsAt.getTime() +
          (result.durationMinutes + result.bufferMinutes) * 60_000,
      );
      return !holds.some((hold) =>
        overlaps(
          startsAt,
          endsAt,
          hold.startsAt,
          new Date(
            hold.endsAt.getTime() + hold.bufferMinutes * 60_000,
          ),
        ),
      );
    });
    const availabilityVersion = this.availabilityVersion({
      ...query,
      timezone: location.timezone,
      durationMinutes: result.durationMinutes,
      bufferMinutes: result.bufferMinutes,
      availableStarts: available.map((slot) => slot.startsAtIso),
      holds,
    });

    return {
      providerId: query.providerId,
      serviceId: query.serviceId,
      locationId: query.locationId,
      dateKey: query.date,
      timezone: location.timezone,
      durationMinutes: result.durationMinutes,
      bufferMinutes: result.bufferMinutes,
      availabilityVersion,
      recommended: available.slice(0, MAX_RECOMMENDED_SLOTS).map(
        (slot, index) =>
          this.rankSlot(slot, index, availabilityVersion, true),
      ),
      later: available.slice(MAX_RECOMMENDED_SLOTS).map((slot, index) =>
        this.rankSlot(
          slot,
          index + MAX_RECOMMENDED_SLOTS,
          availabilityVersion,
          false,
        ),
      ),
    };
  }

  async createHold(
    dto: CreateBookingSlotHoldDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    assertBookingActor(actor, dto.locationId, dto.providerId);
    const location = await this.assertLocation(
      actor.organizationId,
      dto.locationId,
    );

    const startsAt = new Date(dto.startsAtIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ConflictException("The selected slot is invalid");
    }
    const requestHash = this.holdRequestHash(dto, startsAt);
    const replay = await this.prisma.bookingSlotHold.findUnique({
      where: {
        organizationId_createdByUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          createdByUserId: actor.id,
          idempotencyKey: dto.idempotencyKey,
        },
      },
    });
    if (replay) {
      this.assertIdempotentRequest(replay.requestHash, requestHash);
      return this.mapHold(replay);
    }

    const now = await this.databaseNow(this.prisma);
    const bookingHorizon = new Date(now);
    bookingHorizon.setUTCFullYear(bookingHorizon.getUTCFullYear() + 1);
    if (startsAt <= now || startsAt > bookingHorizon) {
      throw new ConflictException(
        "The selected slot is outside the booking horizon",
      );
    }
    const generated = await this.scheduling.listProviderSlots({
      organizationId: actor.organizationId,
      providerId: dto.providerId,
      locationId: dto.locationId,
      serviceId: dto.serviceId,
      dateKey: getNepalAdDateKeyFromIso(dto.startsAtIso),
    });
    if (
      !generated.slots.some(
        (slot) => slot.startsAtIso === startsAt.toISOString(),
      )
    ) {
      throw new ConflictException(
        "That time is no longer an available booking slot",
      );
    }
    await this.scheduling.getEffectiveSlotTiming({
      organizationId: actor.organizationId,
      providerId: dto.providerId,
      locationId: dto.locationId,
      serviceId: dto.serviceId,
      startsAtIso: dto.startsAtIso,
    });

    let hold;
    try {
      hold = await this.prisma.$transaction(
        async (tx) => {
        await this.lockProvider(
          tx,
          actor.organizationId,
          dto.providerId,
        );
        const transactionNow = await this.databaseNow(tx);
        const idempotent = await tx.bookingSlotHold.findUnique({
          where: {
            organizationId_createdByUserId_idempotencyKey: {
              organizationId: actor.organizationId,
              createdByUserId: actor.id,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (idempotent) {
          this.assertIdempotentRequest(idempotent.requestHash, requestHash);
          return idempotent;
        }
        const currentGenerated =
          await this.scheduling.listProviderSlots({
            organizationId: actor.organizationId,
            providerId: dto.providerId,
            locationId: dto.locationId,
            serviceId: dto.serviceId,
            dateKey: getNepalAdDateKeyFromIso(dto.startsAtIso),
          });
        const transactionTiming =
          await this.scheduling.getEffectiveSlotTiming(
            {
              organizationId: actor.organizationId,
              providerId: dto.providerId,
              locationId: dto.locationId,
              serviceId: dto.serviceId,
              startsAtIso: dto.startsAtIso,
            },
            tx,
          );
        const transactionEndsAt = new Date(
          startsAt.getTime() +
            transactionTiming.durationMinutes * 60_000,
        );

        const requestedDateRange = getNepalDayRangeFromDateKey(
          getNepalAdDateKeyFromIso(dto.startsAtIso),
        );
        const activeHolds = await tx.bookingSlotHold.findMany({
          where: {
            organizationId: actor.organizationId,
            providerId: dto.providerId,
            releasedAt: null,
            consumedAt: null,
            expiresAt: { gt: transactionNow },
            startsAt: {
              gte: new Date(
                requestedDateRange.startsAt.getTime() -
                  24 * 60 * 60_000,
              ),
              lte: requestedDateRange.endsAt,
            },
          },
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        });
        const activeUserHolds = await tx.bookingSlotHold.count({
          where: {
            organizationId: actor.organizationId,
            createdByUserId: actor.id,
            releasedAt: null,
            consumedAt: null,
            expiresAt: { gt: transactionNow },
          },
        });
        if (activeUserHolds >= MAX_ACTIVE_HOLDS_PER_USER) {
          throw new ConflictException({
            code: "ACTIVE_HOLD_LIMIT_REACHED",
            message:
              "Release an existing booking hold before selecting another time.",
          });
        }
        const existingDraftHold = await tx.bookingSlotHold.findFirst({
          where: {
            organizationId: actor.organizationId,
            createdByUserId: actor.id,
            draftId: dto.draftId,
            releasedAt: null,
            consumedAt: null,
            expiresAt: { gt: transactionNow },
          },
        });
        if (existingDraftHold) {
          throw new ConflictException({
            code: "DRAFT_ALREADY_HELD",
            message:
              "This booking draft already has a held time. Release it before choosing another.",
          });
        }
        const requestedReservedEnd = new Date(
          transactionEndsAt.getTime() +
            transactionTiming.bufferMinutes * 60_000,
        );
        if (
          activeHolds.some((candidate) =>
            overlaps(
              startsAt,
              requestedReservedEnd,
              candidate.startsAt,
              new Date(
                candidate.endsAt.getTime() +
                  candidate.bufferMinutes * 60_000,
              ),
            ),
          )
        ) {
          throw new ConflictException(
            "That time was just taken. Choose another available slot.",
          );
        }

        const currentAvailable = currentGenerated.slots.filter((slot) => {
          const candidateStart = new Date(slot.startsAtIso);
          const candidateEnd = new Date(
            candidateStart.getTime() +
              (currentGenerated.durationMinutes +
                currentGenerated.bufferMinutes) *
                60_000,
          );
          return (
            candidateStart > transactionNow &&
            !activeHolds.some((candidate) =>
              overlaps(
                candidateStart,
                candidateEnd,
                candidate.startsAt,
                new Date(
                  candidate.endsAt.getTime() +
                    candidate.bufferMinutes * 60_000,
                ),
              ),
            )
          );
        });
        const currentVersion = this.availabilityVersion({
          locationId: dto.locationId,
          providerId: dto.providerId,
          serviceId: dto.serviceId,
          date: getNepalAdDateKeyFromIso(dto.startsAtIso),
          timezone: location.timezone,
          durationMinutes: currentGenerated.durationMinutes,
          bufferMinutes: currentGenerated.bufferMinutes,
          availableStarts: currentAvailable.map(
            (slot) => slot.startsAtIso,
          ),
          holds: activeHolds,
        });
        const expectedSlotId = this.slotId(
          currentVersion,
          startsAt.toISOString(),
        );
        if (
          currentGenerated.durationMinutes !== generated.durationMinutes ||
          currentGenerated.bufferMinutes !== generated.bufferMinutes ||
          dto.availabilityVersion !== currentVersion ||
          dto.slotId !== expectedSlotId
        ) {
          throw new ConflictException({
            code: "AVAILABILITY_CHANGED",
            message:
              "Availability changed while you were choosing. Refresh the times and try again.",
          });
        }

        const holdMinutes = await this.holdMinutes(
          tx,
          actor.organizationId,
        );
        const created = await tx.bookingSlotHold.create({
          data: {
            idempotencyKey: dto.idempotencyKey,
            draftId: dto.draftId,
            requestHash,
            organizationId: actor.organizationId,
            locationId: dto.locationId,
            providerId: dto.providerId,
            serviceId: dto.serviceId,
            startsAt,
            endsAt: transactionEndsAt,
            bufferMinutes: transactionTiming.bufferMinutes,
            expiresAt: new Date(
              transactionNow.getTime() + holdMinutes * 60_000,
            ),
            createdByUserId: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            entityType: "booking_slot_hold",
            entityId: created.id,
            action: "created",
            newValue: {
              providerId: dto.providerId,
              locationId: dto.locationId,
              serviceId: dto.serviceId,
              startsAtIso: startsAt.toISOString(),
              expiresAtIso: created.expiresAt.toISOString(),
            },
            description: "Short booking slot hold created",
          },
        });
        return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.prisma.bookingSlotHold.findUnique({
          where: {
            organizationId_createdByUserId_idempotencyKey: {
              organizationId: actor.organizationId,
              createdByUserId: actor.id,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (winner) {
          this.assertIdempotentRequest(winner.requestHash, requestHash);
          return this.mapHold(winner);
        }
      }
      throw error;
    }

    return this.mapHold(hold);
  }

  async getHold(id: string, authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    const hold = await this.prisma.bookingSlotHold.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        createdByUserId: actor.id,
      },
    });
    if (!hold) throw new NotFoundException("Slot hold not found");
    return this.mapHold(hold);
  }

  async releaseHold(id: string, authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.bookingSlotHold.findFirst({
          where: {
            id,
            organizationId: actor.organizationId,
            createdByUserId: actor.id,
          },
        });
        if (!initial) throw new NotFoundException("Slot hold not found");
        await this.lockProvider(
          tx,
          actor.organizationId,
          initial.providerId,
        );
        const rows = await tx.$queryRaw<
          Array<{ releasedAt: Date | null; consumedAt: Date | null }>
        >(Prisma.sql`
          SELECT "releasedAt", "consumedAt"
          FROM "BookingSlotHold"
          WHERE "id" = ${id}
            AND "organizationId" = ${actor.organizationId}
            AND "createdByUserId" = ${actor.id}
          FOR UPDATE
        `);
        const current = rows[0];
        if (!current) throw new NotFoundException("Slot hold not found");
        if (current.consumedAt) {
          throw new ConflictException(
            "A consumed slot hold cannot be released",
          );
        }
        if (current.releasedAt) {
          return { id, released: true as const };
        }
        const releasedAt = await this.databaseNow(tx);
        await tx.bookingSlotHold.update({
          where: { id },
          data: { releasedAt },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            entityType: "booking_slot_hold",
            entityId: id,
            action: "released",
            description: "Booking slot hold released",
          },
        });
        return { id, released: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private rankSlot(
    slot: {
      startsAtIso: string;
      time: string;
      timeLabel: string;
      dateKey: string;
    },
    index: number,
    availabilityVersion: string,
    recommended: boolean,
  ) {
    return {
      slotId: this.slotId(availabilityVersion, slot.startsAtIso),
      ...slot,
      rank: index + 1,
      rankReason:
        index === 0
          ? ("earliest" as const)
          : recommended
            ? ("next_available" as const)
            : ("later" as const),
      recommended,
    };
  }

  private mapHold(hold: {
    id: string;
    draftId: string;
    idempotencyKey: string;
    organizationId: string;
    locationId: string;
    providerId: string;
    serviceId: string;
    startsAt: Date;
    endsAt: Date;
    bufferMinutes: number;
    expiresAt: Date;
    releasedAt: Date | null;
    consumedAt: Date | null;
  }) {
    const status = hold.consumedAt
      ? "consumed"
      : hold.releasedAt
        ? "released"
        : hold.expiresAt.getTime() <= Date.now()
          ? "expired"
          : "active";
    return {
      id: hold.id,
      draftId: hold.draftId,
      idempotencyKey: hold.idempotencyKey,
      status,
      organizationId: hold.organizationId,
      locationId: hold.locationId,
      providerId: hold.providerId,
      serviceId: hold.serviceId,
      startsAtIso: hold.startsAt.toISOString(),
      endsAtIso: hold.endsAt.toISOString(),
      bufferMinutes: hold.bufferMinutes,
      expiresAtIso: hold.expiresAt.toISOString(),
    };
  }

  private async assertLocation(
    organizationId: string,
    locationId: string,
  ) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId, isActive: true },
      select: { id: true, timezone: true },
    });
    if (!location) {
      throw new ForbiddenException(
        "The selected clinic location is unavailable",
      );
    }
    return location;
  }

  private async holdMinutes(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    const setting = await tx.organizationSetting.findUnique({
      where: { organizationId },
      select: { bookingHoldMinutes: true },
    });
    return setting?.bookingHoldMinutes ?? DEFAULT_HOLD_MINUTES;
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
      throw new NotFoundException("Provider not found");
    }
  }

  private slotId(availabilityVersion: string, startsAtIso: string) {
    return createHash("sha256")
      .update(`${availabilityVersion}:${startsAtIso}`)
      .digest("hex")
      .slice(0, 20);
  }

  private availabilityVersion(input: {
    locationId: string;
    providerId: string;
    serviceId: string;
    date: string;
    timezone: string;
    durationMinutes: number;
    bufferMinutes: number;
    availableStarts: string[];
    holds: Array<{
      id: string;
      startsAt: Date;
      endsAt: Date;
      bufferMinutes: number;
    }>;
  }) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          locationId: input.locationId,
          providerId: input.providerId,
          serviceId: input.serviceId,
          date: input.date,
          timezone: input.timezone,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes,
          availableStarts: [...input.availableStarts].sort(),
          holds: [...input.holds]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((hold) => [
              hold.id,
              hold.startsAt.toISOString(),
              hold.endsAt.toISOString(),
              hold.bufferMinutes,
            ]),
        }),
      )
      .digest("hex")
      .slice(0, 24);
  }

  private holdRequestHash(
    dto: CreateBookingSlotHoldDto,
    startsAt: Date,
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          draftId: dto.draftId,
          locationId: dto.locationId,
          providerId: dto.providerId,
          serviceId: dto.serviceId,
          startsAtIso: startsAt.toISOString(),
          slotId: dto.slotId,
          availabilityVersion: dto.availabilityVersion,
        }),
      )
      .digest("hex");
  }

  private assertIdempotentRequest(
    storedRequestHash: string,
    requestHash: string,
  ) {
    if (storedRequestHash !== requestHash) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message:
          "This idempotency key was already used for a different slot hold.",
      });
    }
  }

  private async databaseNow(
    client: Pick<PrismaService, "$queryRaw"> | Prisma.TransactionClient,
  ) {
    const rows = await client.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
    );
    return rows[0]?.now ?? new Date();
  }
}

function overlaps(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

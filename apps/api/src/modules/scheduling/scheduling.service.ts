import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppointmentStatus, Prisma } from "@prisma/client";

import {
  buildNepalIsoFromDateAndTime,
  getNepalAdDateKeyFromIso,
  getNepalDayOfWeekFromIso,
  getNepalDayRangeFromDateKey,
  getNepalMinutesFromIso,
  inputTimeToMinutes,
  minutesToTimeLabel,
} from "../../lib/nepal-time";
import { PrismaService } from "../prisma/prisma.service";
import { isValidAdDateKey } from "./ad-date-key";
import { ScheduleCacheService } from "./schedule-cache.service";

const blockingStatuses: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "InProgress",
];
// The planner is a 15-minute AD-first grid. Service duration and buffers still
// decide whether a particular grid point can be booked.
const STANDARD_SLOT_MINUTES = 15;

type ServiceTimingParams = {
  organizationId: string;
  providerId: string;
  locationId?: string;
  serviceIds: string[];
};

type SlotAvailabilityParams = {
  organizationId: string;
  providerId: string;
  locationId?: string;
  resourceId?: string;
  startsAtIso: string;
  durationMinutes: number;
  bufferMinutes: number;
  excludeAppointmentId?: string;
};

type EffectiveSlotTimingParams = {
  organizationId: string;
  providerId: string;
  locationId?: string;
  serviceId: string;
  startsAtIso: string;
  excludeAppointmentId?: string;
};

type ProviderSlotParams = {
  organizationId: string;
  providerId: string;
  dateKey: string;
  locationId?: string;
  serviceId?: string;
  durationMinutes?: number;
  excludeAppointmentId?: string;
};

type DaySummaryParams = {
  organizationId: string;
  fromDateKey: string;
  toDateKey: string;
  providerId?: string;
  locationId?: string;
};

type ScheduleGridParams = {
  organizationId: string;
  providerIds?: string[];
  dateKey: string;
  locationId?: string;
};

type DaySummaryResult = Array<{
  dateKey: string;
  appointmentCount: number;
  providerMarkers: Array<{ providerId: string; color: string; count: number }>;
  hasAvailability: boolean;
}>;

type WeekSummaryResult = {
  days: Array<{
    dateKey: string;
    totalAppointments: number;
    statusCounts: Record<string, number>;
    providers: Array<{
      providerId: string;
      name: string;
      color: string;
      appointmentCount: number;
      loadPercent: number;
      hasOpenCapacity: boolean;
    }>;
    hasAvailability: boolean;
  }>;
};

type ScheduleGridResult = {
  date: string;
  timezone: string;
  providers: Array<{
    providerId: string;
    providerName: string;
    providerColor: string;
    specialty: string | null;
    slots: Array<{
      startTime: string;
      endTime: string;
      state: "AVAILABLE" | "BOOKED" | "BLOCKED" | "UNAVAILABLE";
      appointmentId?: string;
      appointmentSummary?: {
        customerName: string;
        serviceName: string;
        status: AppointmentStatus;
      };
    }>;
  }>;
};

type ProviderSlotsResult = {
  providerId: string;
  dateKey: string;
  durationMinutes: number;
  bufferMinutes: number;
  slots: Array<{
    startsAtIso: string;
    time: string;
    timeLabel: string;
    dateKey: string;
  }>;
};

type ScheduleConfiguration = {
  businessDayStartsAt: string;
  businessDayEndsAt: string;
  slotStartIntervalMinutes: number;
  version: number;
};

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ScheduleCacheService)
    private readonly cache: ScheduleCacheService,
  ) {}

  async getServiceTiming(
    params: ServiceTimingParams,
    transactionClient?: Prisma.TransactionClient,
  ) {
    if (!params.serviceIds.length) {
      throw new BadRequestException("At least one service is required");
    }

    const db = transactionClient ?? this.prisma;
    const [services, providerServices] = await Promise.all([
      db.service.findMany({
        where: {
          organizationId: params.organizationId,
          id: { in: params.serviceIds },
          isActive: true,
        },
        select: {
          id: true,
          durationMinutes: true,
          bufferMinutes: true,
        },
      }),
      db.providerService.findMany({
        where: {
          providerId: params.providerId,
          isActive: true,
          OR: [{ locationId: params.locationId }, { locationId: null }],
        },
        select: {
          serviceId: true,
          locationId: true,
          customDurationMinutes: true,
        },
      }),
    ]);

    if (services.length !== params.serviceIds.length) {
      throw new BadRequestException("One or more requested services are invalid or inactive");
    }

    const hasExplicitProviderServiceScope = providerServices.length > 0;
    const effectiveProviderServices = new Map<
      string,
      (typeof providerServices)[number]
    >();
    for (const providerService of providerServices) {
      const current = effectiveProviderServices.get(providerService.serviceId);
      if (!current || providerService.locationId === params.locationId) {
        effectiveProviderServices.set(
          providerService.serviceId,
          providerService,
        );
      }
    }
    const supportedServiceIds = new Set(effectiveProviderServices.keys());
    if (
      hasExplicitProviderServiceScope &&
      params.serviceIds.some((serviceId) => !supportedServiceIds.has(serviceId))
    ) {
      throw new ConflictException(
        "The selected provider is not configured to perform all requested services",
      );
    }

    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const durationMinutes = params.serviceIds.reduce((sum, serviceId) => {
      const service = serviceMap.get(serviceId)!;
      const providerService = effectiveProviderServices.get(serviceId);
      return sum + (providerService?.customDurationMinutes ?? service.durationMinutes);
    }, 0);

    const serviceBuffer = Math.max(...services.map((service) => service.bufferMinutes), 0);

    return {
      durationMinutes,
      serviceBufferMinutes: serviceBuffer,
    };
  }

  async assertSlotAvailable(
    params: SlotAvailabilityParams,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const startsAt = new Date(params.startsAtIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException("Invalid appointment start time");
    }

    const scheduleContext = await this.getProviderScheduleContext(
      {
        organizationId: params.organizationId,
        providerId: params.providerId,
        locationId: params.locationId,
        dateKey: getNepalAdDateKeyFromIso(params.startsAtIso),
        resourceId: params.resourceId,
        excludeAppointmentId: params.excludeAppointmentId,
      },
      transactionClient,
    );

    if (!scheduleContext.providerIsBookable) {
      throw new ConflictException("Selected provider is not currently bookable");
    }

    this.assertProviderWindowOpen(
      params.startsAtIso,
      params.durationMinutes,
      params.bufferMinutes,
      scheduleContext.availability,
      scheduleContext.recurringBlocks,
      scheduleContext.blockedTimes,
      scheduleContext.possibleConflicts,
    );
  }

  async getEffectiveSlotTiming(
    params: EffectiveSlotTimingParams,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const timing = await this.getServiceTiming(
      {
        organizationId: params.organizationId,
        providerId: params.providerId,
        locationId: params.locationId,
        serviceIds: [params.serviceId],
      },
      transactionClient,
    );
    const scheduleContext = await this.getProviderScheduleContext(
      {
        organizationId: params.organizationId,
        providerId: params.providerId,
        locationId: params.locationId,
        dateKey: getNepalAdDateKeyFromIso(params.startsAtIso),
        excludeAppointmentId: params.excludeAppointmentId,
      },
      transactionClient,
    );
    if (!scheduleContext.providerIsBookable) {
      throw new ConflictException("Selected provider is not currently bookable");
    }

    const availableBuffers = scheduleContext.availability
      .map((window) =>
        Math.max(window.bufferMinutes, timing.serviceBufferMinutes),
      )
      .filter((bufferMinutes, index) =>
        this.isWindowOpen(
          params.startsAtIso,
          timing.durationMinutes,
          bufferMinutes,
          [scheduleContext.availability[index]],
          scheduleContext.recurringBlocks,
          scheduleContext.blockedTimes,
          scheduleContext.possibleConflicts,
        ),
      );
    if (!availableBuffers.length) {
      throw new ConflictException("Appointment is outside provider availability");
    }

    return {
      durationMinutes: timing.durationMinutes,
      bufferMinutes: Math.min(...availableBuffers),
    };
  }

  async listProviderSlots(params: ProviderSlotParams): Promise<ProviderSlotsResult> {
    if (!isValidAdDateKey(params.dateKey)) {
      throw new BadRequestException(
        "Date must be a real Gregorian AD date in YYYY-MM-DD format",
      );
    }
    if (
      params.durationMinutes !== undefined &&
      (!Number.isInteger(params.durationMinutes) ||
        params.durationMinutes < 1 ||
        params.durationMinutes > 1440)
    ) {
      throw new BadRequestException(
        "Duration must be a whole number between 1 and 1440 minutes",
      );
    }

    const configuration = await this.getScheduleConfiguration(
      params.organizationId,
    );
    const cacheKey = this.buildProviderSlotsCacheKey(
      params,
      configuration.version,
    );
    const cached = this.cache.get<ProviderSlotsResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const timing = params.serviceId
      ? await this.getServiceTiming({
          organizationId: params.organizationId,
          providerId: params.providerId,
          locationId: params.locationId,
          serviceIds: [params.serviceId],
        })
      : null;

    const scheduleContext = await this.getProviderScheduleContext({
      organizationId: params.organizationId,
      providerId: params.providerId,
      locationId: params.locationId,
      dateKey: params.dateKey,
      excludeAppointmentId: params.excludeAppointmentId,
    });

    if (!scheduleContext.providerIsBookable) {
      return {
        providerId: params.providerId,
        dateKey: params.dateKey,
        durationMinutes:
          timing?.durationMinutes ?? params.durationMinutes ?? STANDARD_SLOT_MINUTES,
        bufferMinutes: timing?.serviceBufferMinutes ?? 0,
        slots: [] as Array<{
          startsAtIso: string;
          time: string;
          timeLabel: string;
          dateKey: string;
        }>,
      };
    }

    const slots: Array<{
      startsAtIso: string;
      time: string;
      timeLabel: string;
      dateKey: string;
    }> = [];
    const requestedDurationMinutes =
      timing?.durationMinutes ?? params.durationMinutes ?? STANDARD_SLOT_MINUTES;

    for (const window of scheduleContext.availability) {
      const slotStepMinutes = configuration.slotStartIntervalMinutes;
      const durationMinutes = requestedDurationMinutes;
      const bufferMinutes = Math.max(window.bufferMinutes, timing?.serviceBufferMinutes ?? 0);
      const windowStart = inputTimeToMinutes(window.startsAtLocal);
      const windowEnd = inputTimeToMinutes(window.endsAtLocal);

      for (
        let startMinutes = windowStart;
        startMinutes + durationMinutes <= windowEnd;
        startMinutes += slotStepMinutes
      ) {
        const time = minutesToTimeLabel(startMinutes);
        const startsAtIso = buildNepalIsoFromDateAndTime(params.dateKey, time);

        const isAvailable = this.isWindowOpen(
          startsAtIso,
          durationMinutes,
          bufferMinutes,
          [window],
          scheduleContext.recurringBlocks,
          scheduleContext.blockedTimes,
          scheduleContext.possibleConflicts,
        );

        if (!isAvailable) {
          continue;
        }

        slots.push({
          startsAtIso,
          time,
          timeLabel: time,
          dateKey: params.dateKey,
        });
      }
    }

    const response: ProviderSlotsResult = {
      providerId: params.providerId,
      dateKey: params.dateKey,
      durationMinutes: requestedDurationMinutes,
      bufferMinutes: timing?.serviceBufferMinutes ?? 0,
      slots,
    };

    this.cache.set(cacheKey, response);
    return response;
  }

  async listDaySummaries(params: DaySummaryParams) {
    const cacheKey = this.buildDaySummariesCacheKey(params);
    const cached = this.cache.get<DaySummaryResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const rangeStart = getNepalDayRangeFromDateKey(params.fromDateKey).startsAt;
    const rangeEnd = getNepalDayRangeFromDateKey(params.toDateKey).endsAt;

    const [appointments, activeProviders] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          organizationId: params.organizationId,
          providerId: params.providerId,
          locationId: params.locationId,
          startsAt: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          providerId: true,
          startsAt: true,
          status: true,
          provider: {
            select: {
              color: true,
            },
          },
        },
      }),
      this.prisma.provider.findMany({
        where: {
          organizationId: params.organizationId,
          id: params.providerId,
          status: { not: "Inactive" },
          OR: [{ userId: null }, { user: { status: "Active" } }],
        },
        select: {
          id: true,
          availability: {
            where: {
              isActive: true,
              OR: [{ locationId: params.locationId }, { locationId: null }],
            },
            select: {
              dayOfWeek: true,
              startsAtLocal: true,
              endsAtLocal: true,
            },
          },
          recurringBlocks: {
            where: {
              isActive: true,
              OR: [{ locationId: params.locationId }, { locationId: null }],
            },
            select: {
              dayOfWeek: true,
              startsAtLocal: true,
              endsAtLocal: true,
            },
          },
        },
      }),
    ]);

    const appointmentMap = new Map<
      string,
      {
        appointmentCount: number;
        providers: Map<string, { providerId: string; color: string; count: number }>;
      }
    >();

    for (const appointment of appointments) {
      const dateKey = getNepalAdDateKeyFromIso(appointment.startsAt.toISOString());
      if (!appointmentMap.has(dateKey)) {
        appointmentMap.set(dateKey, {
          appointmentCount: 0,
          providers: new Map(),
        });
      }

      const day = appointmentMap.get(dateKey)!;
      day.appointmentCount += 1;
      const existingProvider = day.providers.get(appointment.providerId);
      if (existingProvider) {
        existingProvider.count += 1;
      } else {
        day.providers.set(appointment.providerId, {
          providerId: appointment.providerId,
          color: appointment.provider.color,
          count: 1,
        });
      }
    }

    const summaries: Array<{
      dateKey: string;
      appointmentCount: number;
      providerMarkers: Array<{ providerId: string; color: string; count: number }>;
      hasAvailability: boolean;
    }> = [];

    for (
      let cursor = new Date(`${params.fromDateKey}T12:00:00+05:45`);
      cursor <= new Date(`${params.toDateKey}T12:00:00+05:45`);
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const dateKey = cursor.toISOString().slice(0, 10);
      const dayOfWeek = new Date(`${dateKey}T12:00:00+05:45`).getUTCDay();
      const booked = appointmentMap.get(dateKey);

      summaries.push({
        dateKey,
        appointmentCount: booked?.appointmentCount ?? 0,
        providerMarkers: booked ? Array.from(booked.providers.values()) : [],
        hasAvailability: activeProviders.some((provider) =>
          provider.availability.some((window) => {
            if (window.dayOfWeek !== dayOfWeek) {
              return false;
            }
            const fullyCovered = provider.recurringBlocks.some(
              (block) =>
                block.dayOfWeek === dayOfWeek &&
                inputTimeToMinutes(block.startsAtLocal) <=
                  inputTimeToMinutes(window.startsAtLocal) &&
                inputTimeToMinutes(block.endsAtLocal) >=
                  inputTimeToMinutes(window.endsAtLocal),
            );
            return !fullyCovered;
          }),
        ),
      });
    }

    this.cache.set(cacheKey, summaries);
    return summaries;
  }

  async listWeekSummaries(params: DaySummaryParams) {
    const cacheKey = this.buildWeekSummariesCacheKey(params);
    const cached = this.cache.get<WeekSummaryResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const rangeStart = getNepalDayRangeFromDateKey(params.fromDateKey).startsAt;
    const rangeEnd = getNepalDayRangeFromDateKey(params.toDateKey).endsAt;

    const [appointments, providers] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          organizationId: params.organizationId,
          providerId: params.providerId,
          locationId: params.locationId,
          startsAt: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          providerId: true,
          startsAt: true,
          durationMinutes: true,
          bufferMinutes: true,
          status: true,
          provider: {
            select: {
              displayName: true,
              color: true,
              status: true,
              user: {
                select: { status: true },
              },
              availability: {
                where: {
                  isActive: true,
                  OR: [{ locationId: params.locationId }, { locationId: null }],
                },
                select: {
                  dayOfWeek: true,
                  startsAtLocal: true,
                  endsAtLocal: true,
                },
              },
              recurringBlocks: {
                where: {
                  isActive: true,
                  OR: [{ locationId: params.locationId }, { locationId: null }],
                },
                select: {
                  dayOfWeek: true,
                  startsAtLocal: true,
                  endsAtLocal: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.provider.findMany({
        where: {
          organizationId: params.organizationId,
          id: params.providerId ? params.providerId : undefined,
          status: { not: "Inactive" },
          OR: [{ userId: null }, { user: { status: "Active" } }],
        },
        select: {
          id: true,
          displayName: true,
          color: true,
          availability: {
            where: {
              isActive: true,
              OR: [{ locationId: params.locationId }, { locationId: null }],
            },
            select: {
              dayOfWeek: true,
              startsAtLocal: true,
              endsAtLocal: true,
            },
          },
          recurringBlocks: {
            where: {
              isActive: true,
              OR: [{ locationId: params.locationId }, { locationId: null }],
            },
            select: {
              dayOfWeek: true,
              startsAtLocal: true,
              endsAtLocal: true,
            },
          },
        },
      }),
    ]);

    const days = this.buildDateKeys(params.fromDateKey, params.toDateKey).map((dateKey) => {
      const dayAppointments = appointments.filter(
        (appointment) => getNepalAdDateKeyFromIso(appointment.startsAt.toISOString()) === dateKey,
      );
      const statusCounts = Object.fromEntries(
        [
          "Scheduled",
          "Confirmed",
          "Cancelled",
          "NoShow",
          "CheckedIn",
          "InProgress",
          "Completed",
          "Rescheduled",
          "FollowUpRequired",
        ].map((status) => [
          status,
          dayAppointments.filter((appointment) => appointment.status === status).length,
        ]),
      );
      const dayOfWeek = new Date(`${dateKey}T12:00:00+05:45`).getUTCDay();
      const providerSummaries = providers.map((provider) => {
        const providerAppointments = dayAppointments.filter(
          (appointment) => appointment.providerId === provider.id,
        );
        const capacityMinutes = provider.availability
          .filter((window) => window.dayOfWeek === dayOfWeek)
          .reduce(
            (sum, window) =>
              sum +
              (inputTimeToMinutes(window.endsAtLocal) -
                inputTimeToMinutes(window.startsAtLocal)),
            0,
          );
        const blockedMinutes = provider.recurringBlocks
          .filter((block) => block.dayOfWeek === dayOfWeek)
          .reduce(
            (sum, block) =>
              sum +
              (inputTimeToMinutes(block.endsAtLocal) -
                inputTimeToMinutes(block.startsAtLocal)),
            0,
          );
        const openCapacityMinutes = Math.max(capacityMinutes - blockedMinutes, 0);
        const bookedMinutes = providerAppointments.reduce(
          (sum, appointment) => sum + appointment.durationMinutes + appointment.bufferMinutes,
          0,
        );
        const loadPercent =
          openCapacityMinutes > 0
            ? Math.min(100, Math.round((bookedMinutes / openCapacityMinutes) * 100))
            : providerAppointments.length
              ? 100
              : 0;

        return {
          providerId: provider.id,
          name: provider.displayName,
          color: provider.color,
          appointmentCount: providerAppointments.length,
          loadPercent,
          hasOpenCapacity: openCapacityMinutes > bookedMinutes,
        };
      });

      return {
        dateKey,
        totalAppointments: dayAppointments.length,
        statusCounts,
        providers: providerSummaries,
        hasAvailability: providerSummaries.some((provider) => provider.hasOpenCapacity),
      };
    });

    const response = { days };
    this.cache.set(cacheKey, response);
    return response;
  }

  async listScheduleGridForDay(params: ScheduleGridParams) {
    const configuration = await this.getScheduleConfiguration(
      params.organizationId,
    );
    const cacheKey = this.buildScheduleGridCacheKey(
      params,
      configuration.version,
    );
    const cached = this.cache.get<ScheduleGridResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const providerIds =
      params.providerIds && params.providerIds.length
        ? [...new Set(params.providerIds)]
        : (
            await this.prisma.provider.findMany({
              where: {
                organizationId: params.organizationId,
                status: { not: "Inactive" },
                OR: [{ userId: null }, { user: { status: "Active" } }],
              },
              select: { id: true },
              orderBy: { displayName: "asc" },
            })
          ).map((provider) => provider.id);

    const dayRange = getNepalDayRangeFromDateKey(params.dateKey);
    // These are independent read-model projections. With a bounded Prisma
    // pool they should overlap the remote database RTT instead of paying it
    // three times in series. Booking commands still re-check authoritatively
    // inside their transaction.
    const [scheduleContexts, appointments] = await Promise.all([
      this.getProviderScheduleContexts({
        organizationId: params.organizationId,
        providerIds,
        dateKey: params.dateKey,
        locationId: params.locationId,
        includeConflicts: false,
      }),
      this.prisma.appointment.findMany({
        where: {
          organizationId: params.organizationId,
          providerId: { in: providerIds },
          status: { in: blockingStatuses },
          startsAt: {
            gte: dayRange.startsAt,
            lte: dayRange.endsAt,
          },
        },
        select: {
          id: true,
          providerId: true,
          startsAt: true,
          endsAt: true,
          durationMinutes: true,
          bufferMinutes: true,
          status: true,
          customer: { select: { fullName: true } },
          services: {
            select: {
              service: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: [{ providerId: "asc" }, { startsAt: "asc" }],
      }),
    ]);

    if (providerIds.some((providerId) => !scheduleContexts.get(providerId)?.providerExists)) {
      throw new NotFoundException("One or more providers were not found");
    }

    const appointmentsByProvider = new Map<string, typeof appointments>();
    for (const appointment of appointments) {
      const list = appointmentsByProvider.get(appointment.providerId) ?? [];
      list.push(appointment);
      appointmentsByProvider.set(appointment.providerId, list);
    }

    const providers = providerIds.map((providerId) => {
        const scheduleContext = scheduleContexts.get(providerId);
        if (!scheduleContext) {
          return null;
        }

        const slotStepMinutes = configuration.slotStartIntervalMinutes;
        const daySlots: Array<{
          startTime: string;
          endTime: string;
          state: "AVAILABLE" | "BOOKED" | "BLOCKED" | "UNAVAILABLE";
          appointmentId?: string;
          appointmentSummary?: {
            customerName: string;
            serviceName: string;
            status: AppointmentStatus;
          };
        }> = [];

        const providerAppointments = appointmentsByProvider.get(providerId) ?? [];

        const gridStarts = inputTimeToMinutes(configuration.businessDayStartsAt);
        const gridEnds = inputTimeToMinutes(configuration.businessDayEndsAt);
        const candidateMinutes = new Set<number>();
        for (
          let minutes = gridStarts;
          minutes < gridEnds;
          minutes += slotStepMinutes
        ) {
          candidateMinutes.add(minutes);
        }
        for (const appointment of providerAppointments) {
          candidateMinutes.add(
            getNepalMinutesFromIso(appointment.startsAt.toISOString()),
          );
        }

        for (const minutes of [...candidateMinutes].sort((left, right) => left - right)) {
          const time = minutesToTimeLabel(minutes);
          const startTime = buildNepalIsoFromDateAndTime(params.dateKey, time);
          const appointment = providerAppointments.find(
            (item) => getNepalMinutesFromIso(item.startsAt.toISOString()) === minutes,
          );

          if (appointment) {
            daySlots.push({
              startTime,
              endTime: appointment.endsAt.toISOString(),
              state: "BOOKED",
              appointmentId: appointment.id,
              appointmentSummary: {
                customerName: appointment.customer.fullName,
                serviceName:
                  appointment.services.map((entry) => entry.service.name).join(", ") ||
                  "Service",
                status: appointment.status,
              },
            });
            continue;
          }

          const startMinutes = minutes;
          const insideAvailability = scheduleContext.availability.some(
            (window) =>
              startMinutes >= inputTimeToMinutes(window.startsAtLocal) &&
              startMinutes < inputTimeToMinutes(window.endsAtLocal),
          );

          if (!insideAvailability) {
            daySlots.push({
              startTime,
              endTime: new Date(new Date(startTime).getTime() + slotStepMinutes * 60_000).toISOString(),
              state: "UNAVAILABLE",
            });
            continue;
          }

          const recurringBlocked = scheduleContext.recurringBlocks.some(
            (block) =>
              startMinutes >= inputTimeToMinutes(block.startsAtLocal) &&
              startMinutes < inputTimeToMinutes(block.endsAtLocal),
          );
          const oneOffBlocked = scheduleContext.blockedTimes.some((block) => {
            const blockStart = getNepalMinutesFromIso(block.startsAt.toISOString());
            const blockEnd = getNepalMinutesFromIso(block.endsAt.toISOString());
            return startMinutes >= blockStart && startMinutes < blockEnd;
          });

          daySlots.push({
            startTime,
            endTime: new Date(new Date(startTime).getTime() + slotStepMinutes * 60_000).toISOString(),
            state: recurringBlocked || oneOffBlocked ? "BLOCKED" : "AVAILABLE",
          });
        }

        return {
          providerId,
          providerName: scheduleContext.providerName,
          providerColor: scheduleContext.providerColor,
          specialty: scheduleContext.specialty,
          slots: daySlots,
        };
      });

    const response: ScheduleGridResult = {
      date: params.dateKey,
      timezone: "Asia/Kathmandu",
      providers: providers.filter(
        (
          provider,
        ): provider is ScheduleGridResult["providers"][number] => provider !== null,
      ),
    };

    this.cache.set(cacheKey, response);
    return response;
  }

  invalidateAppointmentPlanning(params: {
    organizationId: string;
    providerIds: string[];
    dateKeys: string[];
    locationId?: string;
  }) {
    this.invalidatePlanningCaches({
      organizationId: params.organizationId,
      providerIds: params.providerIds,
      dateKeys: params.dateKeys,
      locationId: params.locationId,
      clearSummaries: true,
    });
  }

  invalidateProviderSchedulePlanning(params: {
    organizationId: string;
    providerId: string;
    locationId?: string;
  }) {
    this.invalidatePlanningCaches({
      organizationId: params.organizationId,
      providerIds: [params.providerId],
      dateKeys: undefined,
      locationId: params.locationId,
      clearSummaries: true,
    });
  }

  invalidateOrganizationSchedulePlanning(organizationId: string) {
    const prefixes = [
      `schedule:configuration:${organizationId}`,
      `schedule:slots:${organizationId}:`,
      `schedule:day-summary:${organizationId}:`,
      `schedule:week-summary:${organizationId}:`,
      `schedule:grid:${organizationId}:`,
    ];
    for (const key of this.cache.keys()) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        this.cache.delete(key);
      }
    }
  }

  private buildDateKeys(fromDateKey: string, toDateKey: string) {
    const keys: string[] = [];
    for (
      let cursor = new Date(`${fromDateKey}T12:00:00+05:45`);
      cursor <= new Date(`${toDateKey}T12:00:00+05:45`);
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    ) {
      keys.push(cursor.toISOString().slice(0, 10));
    }
    return keys;
  }

  private invalidatePlanningCaches(params: {
    organizationId: string;
    providerIds: string[];
    dateKeys?: string[];
    locationId?: string;
    clearSummaries: boolean;
  }) {
    const providerIdSet = new Set(params.providerIds);
    const dateKeySet = params.dateKeys ? new Set(params.dateKeys) : null;

    for (const key of this.cache.keys()) {
      if (!key.startsWith("schedule:slots:")) {
        continue;
      }
      const { organizationId, providerId, dateKey, locationId } =
        this.parseProviderSlotsCacheKey(key);
      if (organizationId !== params.organizationId) {
        continue;
      }
      if (!providerIdSet.has(providerId)) {
        continue;
      }
      if (dateKeySet && !dateKeySet.has(dateKey)) {
        continue;
      }
      if (params.locationId && locationId && params.locationId !== locationId) {
        continue;
      }
      this.cache.delete(key);
    }

    for (const key of this.cache.keys()) {
      if (!key.startsWith("schedule:grid:")) {
        continue;
      }
      const { organizationId, providerIds, dateKey, locationId } =
        this.parseScheduleGridCacheKey(key);
      if (organizationId !== params.organizationId) {
        continue;
      }
      if (dateKeySet && !dateKeySet.has(dateKey)) {
        continue;
      }
      if (params.locationId && locationId && params.locationId !== locationId) {
        continue;
      }
      if (
        providerIds.length > 0 &&
        !providerIds.some((providerId) => providerIdSet.has(providerId))
      ) {
        continue;
      }
      this.cache.delete(key);
    }

    if (!params.clearSummaries) {
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(`schedule:day-summary:${params.organizationId}:`)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`schedule:week-summary:${params.organizationId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private buildProviderSlotsCacheKey(
    params: ProviderSlotParams,
    configurationVersion: number,
  ) {
    const serviceOrDuration = params.serviceId
      ? `service=${params.serviceId}`
      : `duration=${params.durationMinutes ?? STANDARD_SLOT_MINUTES}`;
    const location = params.locationId
      ? `location=${params.locationId}`
      : "location=none";
    const exclusion = params.excludeAppointmentId
      ? `exclude=${params.excludeAppointmentId}`
      : "exclude=none";
    return `schedule:slots:${params.organizationId}:${params.providerId}:${params.dateKey}:${serviceOrDuration}:${location}:${exclusion}:config=${configurationVersion}`;
  }

  private parseProviderSlotsCacheKey(key: string) {
    const [, , organizationId, providerId, dateKey, , location] = key.split(":");
    return {
      organizationId,
      providerId,
      dateKey,
      locationId:
        location === "location=none"
          ? undefined
          : location?.replace(/^location=/, ""),
    };
  }

  private buildDaySummariesCacheKey(params: DaySummaryParams) {
    return `schedule:day-summary:${params.organizationId}:${params.fromDateKey}:${params.toDateKey}:${params.providerId ?? "provider:none"}:${params.locationId ?? "location:none"}`;
  }

  private buildWeekSummariesCacheKey(params: DaySummaryParams) {
    return `schedule:week-summary:${params.organizationId}:${params.fromDateKey}:${params.toDateKey}:${params.providerId ?? "provider:none"}:${params.locationId ?? "location:none"}`;
  }

  private buildScheduleGridCacheKey(
    params: ScheduleGridParams,
    configurationVersion: number,
  ) {
    const providerIds = [...(params.providerIds ?? [])].sort().join(",");
    return `schedule:grid:${params.organizationId}:${params.dateKey}:${providerIds || "providers:all"}:${params.locationId ?? "location:none"}:config=${configurationVersion}`;
  }

  private async getScheduleConfiguration(
    organizationId: string,
  ): Promise<ScheduleConfiguration> {
    return this.cache.getOrLoad(
      `schedule:configuration:${organizationId}`,
      async () => {
        const settings = await this.prisma.organizationSetting.findUnique({
          where: { organizationId },
          select: {
            businessDayStartsAt: true,
            businessDayEndsAt: true,
            slotStartIntervalMinutes: true,
            scheduleConfigurationVersion: true,
          },
        });
        return {
          businessDayStartsAt: settings?.businessDayStartsAt ?? "08:00",
          businessDayEndsAt: settings?.businessDayEndsAt ?? "18:00",
          slotStartIntervalMinutes:
            settings?.slotStartIntervalMinutes ?? STANDARD_SLOT_MINUTES,
          version: settings?.scheduleConfigurationVersion ?? 1,
        };
      },
      60_000,
    );
  }

  private parseScheduleGridCacheKey(key: string) {
    const [, , organizationId, dateKey, providerIdsValue, locationId] = key.split(":");
    return {
      organizationId,
      dateKey,
      locationId: locationId === "location:none" ? undefined : locationId,
      providerIds:
        providerIdsValue === "providers:all" ? [] : providerIdsValue.split(",").filter(Boolean),
    };
  }

  private async getProviderScheduleContext(params: {
    organizationId: string;
    providerId: string;
    dateKey: string;
    locationId?: string;
    resourceId?: string;
    excludeAppointmentId?: string;
  }, transactionClient?: Prisma.TransactionClient) {
    const contexts = await this.getProviderScheduleContexts(
      {
        organizationId: params.organizationId,
        providerIds: [params.providerId],
        dateKey: params.dateKey,
        locationId: params.locationId,
        resourceId: params.resourceId,
        excludeAppointmentId: params.excludeAppointmentId,
      },
      transactionClient,
    );

    return contexts.get(params.providerId) ?? {
      providerExists: false,
      providerIsBookable: false,
      availability: [],
      recurringBlocks: [],
      blockedTimes: [],
      possibleConflicts: [],
    };
  }

  private async getProviderScheduleContexts(params: {
    organizationId: string;
    providerIds: string[];
    dateKey: string;
    locationId?: string;
    resourceId?: string;
    excludeAppointmentId?: string;
    includeConflicts?: boolean;
  }, transactionClient?: Prisma.TransactionClient) {
    const dayRange = getNepalDayRangeFromDateKey(params.dateKey);
    const dayOfWeek = new Date(`${params.dateKey}T12:00:00+05:45`).getUTCDay();

    const providerIds = [...new Set(params.providerIds)];

    // Phase 2: replace these live queries with snapshot reads when snapshot layer exists
    // Invalidation hooks are already in place via invalidateAppointmentPlanning
    const db = transactionClient ?? this.prisma;
    const queries = [
        db.provider.findMany({
          where: {
            id: { in: providerIds },
            organizationId: params.organizationId,
          },
          select: {
            id: true,
            status: true,
            displayName: true,
            color: true,
            specialty: true,
            user: {
              select: {
                status: true,
              },
            },
          },
        }),
        db.providerAvailability.findMany({
          where: {
            providerId: { in: providerIds },
            organizationId: params.organizationId,
            dayOfWeek,
            isActive: true,
            effectiveFrom: { lte: dayRange.endsAt },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: dayRange.startsAt } },
            ],
            AND: [{ OR: [{ locationId: params.locationId }, { locationId: null }] }],
          },
          select: {
            id: true,
            providerId: true,
            startsAtLocal: true,
            endsAtLocal: true,
            slotDurationMinutes: true,
            bufferMinutes: true,
          },
          orderBy: [{ startsAtLocal: "asc" }],
        }),
        db.providerRecurringBlock.findMany({
          where: {
            providerId: { in: providerIds },
            organizationId: params.organizationId,
            dayOfWeek,
            isActive: true,
            OR: [{ locationId: params.locationId }, { locationId: null }],
          },
          select: {
            id: true,
            providerId: true,
            startsAtLocal: true,
            endsAtLocal: true,
            reason: true,
          },
          orderBy: [{ startsAtLocal: "asc" }],
        }),
        db.blockedTime.findMany({
          where: {
            organizationId: params.organizationId,
            OR: [
              { providerId: { in: providerIds } },
              ...(params.resourceId ? [{ resourceId: params.resourceId }] : []),
            ],
            startsAt: { lte: dayRange.endsAt },
            endsAt: { gte: dayRange.startsAt },
          },
          select: {
            id: true,
            providerId: true,
            startsAt: true,
            endsAt: true,
            reason: true,
          },
          orderBy: [{ startsAt: "asc" }],
        }),
        params.includeConflicts === false ? Promise.resolve([]) : db.appointment.findMany({
          where: {
            organizationId: params.organizationId,
            id: params.excludeAppointmentId ? { not: params.excludeAppointmentId } : undefined,
            status: { in: blockingStatuses },
            OR: [
              { providerId: { in: providerIds } },
              ...(params.resourceId ? [{ resourceId: params.resourceId }] : []),
            ],
            startsAt: { lte: dayRange.endsAt },
            endsAt: { gte: dayRange.startsAt },
          },
          select: {
            id: true,
            providerId: true,
            resourceId: true,
            startsAt: true,
            durationMinutes: true,
            bufferMinutes: true,
          },
        }),
      ] as const;
    const [providers, availabilityRows, recurringBlockRows, blockedTimeRows, conflictRows] =
      await Promise.all(queries);

    const providersById = new Map(providers.map((provider) => [provider.id, provider]));
    const availabilityByProvider = this.groupByProviderId(availabilityRows);
    const recurringBlocksByProvider = this.groupByProviderId(recurringBlockRows);
    const blockedTimesByProvider = this.groupByProviderId(
      blockedTimeRows.filter((item) => item.providerId),
    );
    const conflictsByProvider = this.groupByProviderId(
      conflictRows.filter((item) => item.providerId),
    );
    const sharedBlockedTimes = blockedTimeRows.filter((item) => !item.providerId);
    const sharedConflicts = conflictRows.filter((item) => !item.providerId);

    const contexts = new Map<
      string,
      {
        providerExists: boolean;
        providerIsBookable: boolean;
        providerName: string;
        providerColor: string;
        specialty: string | null;
        availability: Array<{
          id: string;
          providerId: string;
          startsAtLocal: string;
          endsAtLocal: string;
          slotDurationMinutes: number;
          bufferMinutes: number;
        }>;
        recurringBlocks: Array<{
          id: string;
          providerId: string;
          startsAtLocal: string;
          endsAtLocal: string;
          reason: string;
        }>;
        blockedTimes: Array<{
          id: string;
          providerId: string | null;
          startsAt: Date;
          endsAt: Date;
          reason: string;
        }>;
        possibleConflicts: Array<{
          id: string;
          providerId: string;
          resourceId: string | null;
          startsAt: Date;
          durationMinutes: number;
          bufferMinutes: number;
        }>;
      }
    >();

    for (const providerId of providerIds) {
      const provider = providersById.get(providerId);
      contexts.set(providerId, {
        providerExists: Boolean(provider),
        providerIsBookable: Boolean(
          provider &&
            provider.status !== "Inactive" &&
            provider.user?.status !== "Inactive" &&
            provider.user?.status !== "Suspended",
        ),
        providerName: provider?.displayName ?? "Unknown provider",
        providerColor: provider?.color ?? "#0f766e",
        specialty: provider?.specialty ?? null,
        availability: availabilityByProvider.get(providerId) ?? [],
        recurringBlocks: recurringBlocksByProvider.get(providerId) ?? [],
        blockedTimes: [
          ...(blockedTimesByProvider.get(providerId) ?? []),
          ...sharedBlockedTimes,
        ],
        possibleConflicts: [
          ...(conflictsByProvider.get(providerId) ?? []),
          ...sharedConflicts,
        ],
      });
    }

    return contexts;
  }

  private groupByProviderId<T extends { providerId: string | null }>(rows: T[]) {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.providerId) {
        continue;
      }
      const list = grouped.get(row.providerId) ?? [];
      list.push(row);
      grouped.set(row.providerId, list);
    }
    return grouped;
  }

  private assertProviderWindowOpen(
    startsAtIso: string,
    durationMinutes: number,
    bufferMinutes: number,
    availability: Array<{
      startsAtLocal: string;
      endsAtLocal: string;
    }>,
    recurringBlocks: Array<{
      startsAtLocal: string;
      endsAtLocal: string;
      reason: string;
    }>,
    blockedTimes: Array<{
      startsAt: Date;
      endsAt: Date;
      reason: string;
    }>,
    conflicts: Array<{
      startsAt: Date;
      durationMinutes: number;
      bufferMinutes: number;
    }>,
  ) {
    if (
      !this.isWindowOpen(
        startsAtIso,
        durationMinutes,
        bufferMinutes,
        availability,
        recurringBlocks,
        blockedTimes,
        conflicts,
      )
    ) {
      throw new ConflictException("Appointment is outside provider availability");
    }
  }

  private isWindowOpen(
    startsAtIso: string,
    durationMinutes: number,
    bufferMinutes: number,
    availability: Array<{
      startsAtLocal: string;
      endsAtLocal: string;
    }>,
    recurringBlocks: Array<{
      startsAtLocal: string;
      endsAtLocal: string;
      reason?: string;
    }>,
    blockedTimes: Array<{
      startsAt: Date;
      endsAt: Date;
      reason?: string;
    }>,
    conflicts: Array<{
      startsAt: Date;
      durationMinutes: number;
      bufferMinutes: number;
    }>,
  ) {
    const startMinutes = getNepalMinutesFromIso(startsAtIso);
    const endMinutes = startMinutes + durationMinutes;
    const reservedUntilMinutes = startMinutes + durationMinutes + bufferMinutes;
    const startsAt = new Date(startsAtIso);
    const reservedUntil = new Date(
      startsAt.getTime() + (durationMinutes + bufferMinutes) * 60_000,
    );

    const insideAvailability = availability.some(
      (window) =>
        startMinutes >= inputTimeToMinutes(window.startsAtLocal) &&
        endMinutes <= inputTimeToMinutes(window.endsAtLocal),
    );

    if (!insideAvailability) {
      return false;
    }

    const recurringBlocked = recurringBlocks.some(
      (block) =>
        startMinutes < inputTimeToMinutes(block.endsAtLocal) &&
        reservedUntilMinutes > inputTimeToMinutes(block.startsAtLocal),
    );
    if (recurringBlocked) {
      return false;
    }

    const oneOffBlocked = blockedTimes.some(
      (item) => item.startsAt < reservedUntil && item.endsAt > startsAt,
    );
    if (oneOffBlocked) {
      return false;
    }

    const hasConflict = conflicts.some((appointment) => {
      const existingStart = appointment.startsAt.getTime();
      const existingEnd =
        existingStart +
        (appointment.durationMinutes + appointment.bufferMinutes) * 60_000;
      return startsAt.getTime() < existingEnd && reservedUntil.getTime() > existingStart;
    });

    return !hasConflict;
  }
}

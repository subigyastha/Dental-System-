import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { AppointmentStatus } from "@prisma/client";

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

const blockingStatuses: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "FollowUpRequired",
];
const STANDARD_SLOT_MINUTES = 60;

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

type ProviderSlotParams = {
  organizationId: string;
  providerId: string;
  dateKey: string;
  locationId?: string;
  serviceId?: string;
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

@Injectable()
export class SchedulingService {
  private readonly providerSlotsCache = new Map<string, ProviderSlotsResult>();
  private readonly daySummariesCache = new Map<string, DaySummaryResult>();
  private readonly weekSummariesCache = new Map<string, WeekSummaryResult>();
  private readonly scheduleGridCache = new Map<string, ScheduleGridResult>();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async getServiceTiming(params: ServiceTimingParams) {
    if (!params.serviceIds.length) {
      throw new BadRequestException("At least one service is required");
    }

    const [services, providerServices] = await Promise.all([
      this.prisma.service.findMany({
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
      this.prisma.providerService.findMany({
        where: {
          providerId: params.providerId,
          serviceId: { in: params.serviceIds },
          isActive: true,
          OR: [{ locationId: params.locationId }, { locationId: null }],
        },
        select: {
          serviceId: true,
          customDurationMinutes: true,
        },
      }),
    ]);

    if (services.length !== params.serviceIds.length) {
      throw new BadRequestException("One or more requested services are invalid or inactive");
    }

    const hasExplicitProviderServiceScope = providerServices.length > 0;
    const supportedServiceIds = new Set(providerServices.map((item) => item.serviceId));
    if (
      hasExplicitProviderServiceScope &&
      params.serviceIds.some((serviceId) => !supportedServiceIds.has(serviceId))
    ) {
      throw new ConflictException(
        "The selected provider is not configured to perform all requested services",
      );
    }

    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const providerServiceMap = new Map(
      providerServices.map((item) => [item.serviceId, item]),
    );

    const durationMinutes = params.serviceIds.reduce((sum, serviceId) => {
      const service = serviceMap.get(serviceId)!;
      const providerService = providerServiceMap.get(serviceId);
      return sum + (providerService?.customDurationMinutes ?? service.durationMinutes);
    }, 0);

    const serviceBuffer = Math.max(...services.map((service) => service.bufferMinutes), 0);

    return {
      durationMinutes,
      serviceBufferMinutes: serviceBuffer,
    };
  }

  async assertSlotAvailable(params: SlotAvailabilityParams) {
    const startsAt = new Date(params.startsAtIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException("Invalid appointment start time");
    }

    const scheduleContext = await this.getProviderScheduleContext({
      organizationId: params.organizationId,
      providerId: params.providerId,
      locationId: params.locationId,
      dateKey: getNepalAdDateKeyFromIso(params.startsAtIso),
      resourceId: params.resourceId,
      excludeAppointmentId: params.excludeAppointmentId,
    });

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

  async listProviderSlots(params: ProviderSlotParams): Promise<ProviderSlotsResult> {
    const cacheKey = this.buildProviderSlotsCacheKey(params);
    const cached = this.providerSlotsCache.get(cacheKey);
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
        durationMinutes: timing?.durationMinutes ?? 0,
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

    for (const window of scheduleContext.availability) {
      const slotStepMinutes = STANDARD_SLOT_MINUTES;
      const durationMinutes = timing?.durationMinutes ?? STANDARD_SLOT_MINUTES;
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
      durationMinutes: timing?.durationMinutes ?? 0,
      bufferMinutes: timing?.serviceBufferMinutes ?? 0,
      slots,
    };

    this.providerSlotsCache.set(cacheKey, response);
    return response;
  }

  async listDaySummaries(params: DaySummaryParams) {
    const cacheKey = this.buildDaySummariesCacheKey(params);
    const cached = this.daySummariesCache.get(cacheKey);
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

    this.daySummariesCache.set(cacheKey, summaries);
    return summaries;
  }

  async listWeekSummaries(params: DaySummaryParams) {
    const cacheKey = this.buildWeekSummariesCacheKey(params);
    const cached = this.weekSummariesCache.get(cacheKey);
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
    this.weekSummariesCache.set(cacheKey, response);
    return response;
  }

  async listScheduleGridForDay(params: ScheduleGridParams) {
    const cacheKey = this.buildScheduleGridCacheKey(params);
    const cached = this.scheduleGridCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const providerIds =
      params.providerIds && params.providerIds.length
        ? params.providerIds
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

    const providers = await Promise.all(
      providerIds.map(async (providerId) => {
        const scheduleContext = await this.getProviderScheduleContext({
          organizationId: params.organizationId,
          providerId,
          dateKey: params.dateKey,
          locationId: params.locationId,
        });

        const provider = await this.prisma.provider.findFirst({
          where: { id: providerId, organizationId: params.organizationId },
          select: {
            id: true,
            displayName: true,
            color: true,
            specialty: true,
          },
        });

        if (!provider) {
          return null;
        }

        const slotStepMinutes =
          STANDARD_SLOT_MINUTES;
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

        const appointments = await this.prisma.appointment.findMany({
          where: {
            organizationId: params.organizationId,
            providerId,
            status: { in: blockingStatuses },
            startsAt: {
              gte: getNepalDayRangeFromDateKey(params.dateKey).startsAt,
              lte: getNepalDayRangeFromDateKey(params.dateKey).endsAt,
            },
          },
          select: {
            id: true,
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
          orderBy: { startsAt: "asc" },
        });

        for (let minutes = 8 * 60; minutes <= 19 * 60; minutes += slotStepMinutes) {
          const time = minutesToTimeLabel(minutes);
          const startTime = buildNepalIsoFromDateAndTime(params.dateKey, time);
          const appointment = appointments.find(
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
          providerId: provider.id,
          providerName: provider.displayName,
          providerColor: provider.color,
          specialty: provider.specialty,
          slots: daySlots,
        };
      }),
    );

    const response: ScheduleGridResult = {
      date: params.dateKey,
      timezone: "Asia/Kathmandu",
      providers: providers.filter(
        (
          provider,
        ): provider is ScheduleGridResult["providers"][number] => provider !== null,
      ),
    };

    this.scheduleGridCache.set(cacheKey, response);
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

    for (const key of this.providerSlotsCache.keys()) {
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
      this.providerSlotsCache.delete(key);
    }

    for (const key of this.scheduleGridCache.keys()) {
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
      if (!providerIds.some((providerId) => providerIdSet.has(providerId))) {
        continue;
      }
      this.scheduleGridCache.delete(key);
    }

    if (!params.clearSummaries) {
      return;
    }

    for (const key of this.daySummariesCache.keys()) {
      if (key.startsWith(`${params.organizationId}|`)) {
        this.daySummariesCache.delete(key);
      }
    }
    for (const key of this.weekSummariesCache.keys()) {
      if (key.startsWith(`${params.organizationId}|`)) {
        this.weekSummariesCache.delete(key);
      }
    }
  }

  private buildProviderSlotsCacheKey(params: ProviderSlotParams) {
    return [
      params.organizationId,
      params.providerId,
      params.dateKey,
      params.locationId ?? "location:none",
      params.serviceId ?? "service:none",
      params.excludeAppointmentId ?? "exclude:none",
    ].join("|");
  }

  private parseProviderSlotsCacheKey(key: string) {
    const [organizationId, providerId, dateKey, locationId] = key.split("|", 4);
    return {
      organizationId,
      providerId,
      dateKey,
      locationId: locationId === "location:none" ? undefined : locationId,
    };
  }

  private buildDaySummariesCacheKey(params: DaySummaryParams) {
    return [
      params.organizationId,
      params.fromDateKey,
      params.toDateKey,
      params.providerId ?? "provider:none",
      params.locationId ?? "location:none",
    ].join("|");
  }

  private buildWeekSummariesCacheKey(params: DaySummaryParams) {
    return [
      params.organizationId,
      params.fromDateKey,
      params.toDateKey,
      params.providerId ?? "provider:none",
      params.locationId ?? "location:none",
      "week",
    ].join("|");
  }

  private buildScheduleGridCacheKey(params: ScheduleGridParams) {
    const providerIds = [...(params.providerIds ?? [])].sort().join(",");
    return [
      params.organizationId,
      params.dateKey,
      params.locationId ?? "location:none",
      providerIds || "providers:all",
    ].join("|");
  }

  private parseScheduleGridCacheKey(key: string) {
    const [organizationId, dateKey, locationId, providerIdsValue] = key.split("|", 4);
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
  }) {
    const dayRange = getNepalDayRangeFromDateKey(params.dateKey);
    const dayOfWeek = new Date(`${params.dateKey}T12:00:00+05:45`).getUTCDay();

    const [provider, availability, recurringBlocks, blockedTimes, possibleConflicts] =
      await Promise.all([
        this.prisma.provider.findFirst({
          where: {
            id: params.providerId,
            organizationId: params.organizationId,
          },
          select: {
            id: true,
            status: true,
            user: {
              select: {
                status: true,
              },
            },
          },
        }),
        this.prisma.providerAvailability.findMany({
          where: {
            providerId: params.providerId,
            organizationId: params.organizationId,
            dayOfWeek,
            isActive: true,
            OR: [{ locationId: params.locationId }, { locationId: null }],
          },
          select: {
            id: true,
            startsAtLocal: true,
            endsAtLocal: true,
            slotDurationMinutes: true,
            bufferMinutes: true,
          },
          orderBy: [{ startsAtLocal: "asc" }],
        }),
        this.prisma.providerRecurringBlock.findMany({
          where: {
            providerId: params.providerId,
            organizationId: params.organizationId,
            dayOfWeek,
            isActive: true,
            OR: [{ locationId: params.locationId }, { locationId: null }],
          },
          select: {
            id: true,
            startsAtLocal: true,
            endsAtLocal: true,
            reason: true,
          },
          orderBy: [{ startsAtLocal: "asc" }],
        }),
        this.prisma.blockedTime.findMany({
          where: {
            organizationId: params.organizationId,
            OR: [
              { providerId: params.providerId },
              ...(params.resourceId ? [{ resourceId: params.resourceId }] : []),
            ],
            startsAt: { lte: dayRange.endsAt },
            endsAt: { gte: dayRange.startsAt },
          },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            reason: true,
          },
          orderBy: [{ startsAt: "asc" }],
        }),
        this.prisma.appointment.findMany({
          where: {
            organizationId: params.organizationId,
            id: params.excludeAppointmentId ? { not: params.excludeAppointmentId } : undefined,
            status: { in: blockingStatuses },
            OR: [
              { providerId: params.providerId },
              ...(params.resourceId ? [{ resourceId: params.resourceId }] : []),
            ],
            startsAt: { lte: dayRange.endsAt },
            endsAt: { gte: dayRange.startsAt },
          },
          select: {
            id: true,
            startsAt: true,
            durationMinutes: true,
            bufferMinutes: true,
          },
        }),
      ]);

    const providerIsBookable = Boolean(
      provider &&
        provider.status !== "Inactive" &&
        provider.user?.status !== "Inactive" &&
        provider.user?.status !== "Suspended",
    );

    return {
      providerIsBookable,
      availability,
      recurringBlocks,
      blockedTimes,
      possibleConflicts,
    };
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

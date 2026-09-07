import { Controller, Get, Inject, Param, Query, Req, UseFilters } from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";
import { AppointmentsService } from "../appointments/appointments.service";
import { ListAppointmentsDto } from "../appointments/dto/list-appointments.dto";
import { ListDaySummariesDto } from "../appointments/dto/list-day-summaries.dto";
import { ListWeekSummariesDto } from "../appointments/dto/list-week-summaries.dto";
import { ListProviderScheduleGridsDto } from "../providers/dto/list-provider-schedule-grids.dto";
import { ListProviderSlotsDto } from "../providers/dto/list-provider-slots.dto";
import { ProvidersService } from "../providers/providers.service";
import { getNepalDayRangeFromDateKey } from "../../lib/nepal-time";
import { ScheduleDayDto } from "./dto/schedule-day.dto";
import { ScheduleBootstrapService } from "./schedule-bootstrap.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/schedule")
@UseFilters(V1ExceptionFilter)
export class ScheduleV1Controller {
  constructor(
    @Inject(ScheduleBootstrapService)
    private readonly schedule: ScheduleBootstrapService,
    @Inject(AppointmentsService)
    private readonly appointments: AppointmentsService,
    @Inject(ProvidersService)
    private readonly providers: ProvidersService,
  ) {}

  @Get("bootstrap")
  async bootstrap(
    @Query("detail") detail: "summary" | "full" | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.schedule.getBootstrap(authorization, detail),
      request.requestId,
    );
  }

  @Get("appointments")
  async listAppointments(
    @Query() query: ListAppointmentsDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.appointments.list(query, authorization),
      request.requestId,
    );
  }

  @Get("day-summaries")
  async daySummaries(
    @Query() query: ListDaySummariesDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.appointments.listDaySummaries(query, authorization),
      request.requestId,
    );
  }

  @Get("day")
  async day(
    @Query() query: ScheduleDayDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    const providerIds = query.providerIds
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const range = getNepalDayRangeFromDateKey(query.date);
    const [appointments, grid] = await Promise.all([
      this.appointments.list(
        {
          fromIso: range.startsAt.toISOString(),
          toIso: range.endsAt.toISOString(),
          providerIds,
          locationId: query.locationId,
        },
        authorization,
      ),
      this.providers.listScheduleGrids(
        {
          organizationId: query.organizationId,
          dateIso: query.date,
          locationId: query.locationId,
          providerIds: providerIds?.join(","),
        },
        authorization,
      ),
    ]);

    return v1Envelope({ appointments, grid }, request.requestId);
  }

  @Get("week-summaries")
  async weekSummaries(
    @Query() query: ListWeekSummariesDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.appointments.listWeekSummaries(query, authorization),
      request.requestId,
    );
  }

  @Get("grid")
  async grid(
    @Query() query: ListProviderScheduleGridsDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.providers.listScheduleGrids(query, authorization),
      request.requestId,
    );
  }

  @Get("providers/:providerId/slots")
  async providerSlots(
    @Param("providerId") providerId: string,
    @Query() query: ListProviderSlotsDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: string,
  ) {
    return v1Envelope(
      await this.providers.listSlots(providerId, query, authorization),
      request.requestId,
    );
  }
}

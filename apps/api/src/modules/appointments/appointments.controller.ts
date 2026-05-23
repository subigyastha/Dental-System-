import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { AppointmentsService } from "./appointments.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { ListDaySummariesDto } from "./dto/list-day-summaries.dto";
import { ListAppointmentsDto } from "./dto/list-appointments.dto";
import { ListWeekSummariesDto } from "./dto/list-week-summaries.dto";
import { UpdateAppointmentDto } from "./dto/update-appointment.dto";
import { UpdateAppointmentStatusDto } from "./dto/update-appointment-status.dto";

@Controller("appointments")
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService)
    private readonly appointments: AppointmentsService,
  ) {}

  @Get()
  list(
    @Query() query: ListAppointmentsDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.list(query, authorization);
  }

  @Get("day-summaries")
  listDaySummaries(
    @Query() query: ListDaySummariesDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.listDaySummaries(query, authorization);
  }

  @Get("week-summaries")
  listWeekSummaries(
    @Query() query: ListWeekSummariesDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.listWeekSummaries(query, authorization);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.appointments.getOne(id, authorization);
  }

  @Post()
  create(
    @Body() dto: CreateAppointmentDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.create(dto, authorization);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAppointmentDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.update(id, dto, authorization);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.appointments.delete(id, authorization);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateAppointmentStatusDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.appointments.updateStatus(id, dto, authorization);
  }
}

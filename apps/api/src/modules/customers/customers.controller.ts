import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { CreateCustomerDto } from "./dto/create-customer.dto";
import { MatchCustomersDto } from "./dto/match-customers.dto";
import { MergeCustomerDto } from "./dto/merge-customer.dto";
import { ResolveCustomerForAppointmentDto } from "./dto/resolve-customer-for-appointment.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { UpsertVisitReportDto } from "./dto/upsert-visit-report.dto";
import { CustomersService } from "./customers.service";

@Controller("customers")
export class CustomersController {
  constructor(
    @Inject(CustomersService)
    private readonly customers: CustomersService,
  ) {}

  @Get()
  list(@ServiceSession() authorization?: string) {
    return this.customers.list(authorization);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.customers.getOne(id, authorization);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @ServiceSession() authorization?: string) {
    return this.customers.create(dto, authorization);
  }

  @Post("match")
  match(@Body() dto: MatchCustomersDto, @ServiceSession() authorization?: string) {
    return this.customers.match(dto, authorization);
  }

  @Post("resolve-for-appointment")
  resolveForAppointment(
    @Body() dto: ResolveCustomerForAppointmentDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.resolveForAppointment(dto, authorization);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.update(id, dto, authorization);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.customers.delete(id, authorization);
  }

  @Post(":id/merge")
  merge(
    @Param("id") id: string,
    @Body() dto: MergeCustomerDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.merge(id, dto, authorization);
  }

  @Get(":customerId/visit-reports")
  listVisitReports(
    @Param("customerId") customerId: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.listVisitReports(customerId, authorization);
  }

  @Get(":customerId/visit-reports/:reportId")
  getVisitReport(
    @Param("customerId") customerId: string,
    @Param("reportId") reportId: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.getVisitReport(customerId, reportId, authorization);
  }

  @Post(":customerId/visit-reports")
  upsertVisitReport(
    @Param("customerId") customerId: string,
    @Body() dto: UpsertVisitReportDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.upsertVisitReport(customerId, dto, authorization);
  }

  @Delete(":customerId/visit-reports/:reportId")
  deleteVisitReport(
    @Param("customerId") customerId: string,
    @Param("reportId") reportId: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.customers.deleteVisitReport(customerId, reportId, authorization);
  }
}

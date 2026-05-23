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
} from "@nestjs/common";

import { CreateCustomerDto } from "./dto/create-customer.dto";
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
  list(@Headers("authorization") authorization?: string) {
    return this.customers.list(authorization);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.customers.getOne(id, authorization);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @Headers("authorization") authorization?: string) {
    return this.customers.create(dto, authorization);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.customers.update(id, dto, authorization);
  }

  @Delete(":id")
  delete(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.customers.delete(id, authorization);
  }

  @Get(":customerId/visit-reports")
  listVisitReports(
    @Param("customerId") customerId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.customers.listVisitReports(customerId, authorization);
  }

  @Get(":customerId/visit-reports/:reportId")
  getVisitReport(
    @Param("customerId") customerId: string,
    @Param("reportId") reportId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.customers.getVisitReport(customerId, reportId, authorization);
  }

  @Post(":customerId/visit-reports")
  upsertVisitReport(
    @Param("customerId") customerId: string,
    @Body() dto: UpsertVisitReportDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.customers.upsertVisitReport(customerId, dto, authorization);
  }

  @Delete(":customerId/visit-reports/:reportId")
  deleteVisitReport(
    @Param("customerId") customerId: string,
    @Param("reportId") reportId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.customers.deleteVisitReport(customerId, reportId, authorization);
  }
}

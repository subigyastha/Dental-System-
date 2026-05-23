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

import { BillingService } from "./billing.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { ListInvoicesDto } from "./dto/list-invoices.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { UpdateInvoiceDto } from "./dto/update-invoice.dto";

@Controller("billing")
export class BillingController {
  constructor(
    @Inject(BillingService)
    private readonly billing: BillingService,
  ) {}

  @Get("invoices")
  listInvoices(
    @Query() query: ListInvoicesDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.listInvoices(query, authorization);
  }

  @Get("invoices/:id")
  getInvoice(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.billing.getInvoice(id, authorization);
  }

  @Post("invoices")
  createInvoice(
    @Body() dto: CreateInvoiceDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.createInvoice(dto, authorization);
  }

  @Patch("invoices/:id")
  updateInvoice(
    @Param("id") id: string,
    @Body() dto: UpdateInvoiceDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.updateInvoice(id, dto, authorization);
  }

  @Delete("invoices/:id")
  deleteInvoice(
    @Param("id") id: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.deleteInvoice(id, authorization);
  }

  @Post("invoices/:id/payments")
  recordPayment(
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.recordPayment(id, dto, authorization);
  }

  @Patch("invoices/:id/payments/:paymentId")
  updatePayment(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() dto: RecordPaymentDto,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.updatePayment(id, paymentId, dto, authorization);
  }

  @Delete("invoices/:id/payments/:paymentId")
  deletePayment(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Headers("authorization") authorization?: string,
  ) {
    return this.billing.deletePayment(id, paymentId, authorization);
  }
}

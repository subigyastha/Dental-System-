import {
  Body,
  Controller,
  CanActivate,
  Delete,
  Get,
  Inject,
  GoneException,
  ExecutionContext,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { BillingService } from "./billing.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { ListInvoicesDto } from "./dto/list-invoices.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { UpdateInvoiceDto } from "./dto/update-invoice.dto";
import { IssueInvoiceDto } from "./dto/issue-invoice.dto";
import { CreateFinancialCorrectionDto } from "./dto/create-financial-correction.dto";
import { VoidInvoiceDto } from "./dto/void-invoice.dto";

class LegacyBillingRetiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    if (request.method === "GET") return true;
    throw new GoneException(
      "Legacy billing mutations are retired; use the scoped /api/v1/finance contract",
    );
  }
}

@Controller("billing")
@UseGuards(LegacyBillingRetiredGuard)
export class BillingController {
  constructor(
    @Inject(BillingService)
    private readonly billing: BillingService,
  ) {}

  @Get("invoices")
  listInvoices(
    @Query() query: ListInvoicesDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.listInvoices(query, authorization);
  }

  @Get("invoices/:id")
  getInvoice(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.billing.getInvoice(id, authorization);
  }

  @Post("invoices")
  createInvoice(
    @Body() dto: CreateInvoiceDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.createInvoice(dto, authorization);
  }

  @Patch("invoices/:id")
  updateInvoice(
    @Param("id") id: string,
    @Body() dto: UpdateInvoiceDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.updateInvoice(id, dto, authorization);
  }

  @Post("invoices/:id/issue")
  issueInvoice(
    @Param("id") id: string,
    @Body() dto: IssueInvoiceDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.issueInvoice(id, dto.organizationId, authorization);
  }

  @Post("invoices/:id/void")
  voidInvoice(
    @Param("id") id: string,
    @Body() dto: VoidInvoiceDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.voidInvoice(id, dto.organizationId, dto.reason, authorization);
  }

  @Delete("invoices/:id")
  deleteInvoice(
    @Param("id") id: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.deleteInvoice(id, authorization);
  }

  @Post("invoices/:id/payments")
  recordPayment(
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.recordPayment(id, dto, authorization);
  }

  @Post("invoices/:id/payments/:paymentId/corrections")
  createCorrection(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() dto: CreateFinancialCorrectionDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.createFinancialCorrection(id, paymentId, dto, authorization);
  }

  @Patch("invoices/:id/payments/:paymentId")
  updatePayment(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() dto: RecordPaymentDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.updatePayment(id, paymentId, dto, authorization);
  }

  @Delete("invoices/:id/payments/:paymentId")
  deletePayment(
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.billing.deletePayment(id, paymentId, authorization);
  }
}

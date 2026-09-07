import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
} from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import {
  ApproveFinanceCorrectionDto,
  CreateFinanceCorrectionDto,
  CreateFinanceInvoiceDto,
  FinanceCorrectionQueryDto,
  FinanceReconciliationQueryDto,
  FinanceWorkspaceQueryDto,
  RecordFinancePaymentDto,
  RejectFinanceCorrectionDto,
} from "./dto/finance-ledger.dto";
import { FinanceLedgerService } from "./finance-ledger.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/finance")
@UseFilters(V1ExceptionFilter)
export class FinanceV1Controller {
  constructor(
    @Inject(FinanceLedgerService)
    private readonly finance: FinanceLedgerService,
  ) {}

  @Get("workspace")
  async workspace(
    @Query() query: FinanceWorkspaceQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.workspace(query, authorization),
      request.requestId,
    );
  }

  @Post("invoices")
  async createInvoice(
    @Body() dto: CreateFinanceInvoiceDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.finance.createInvoice(dto, idempotencyKey!, authorization),
      request.requestId,
    );
  }

  @Get("invoices/:id")
  async invoiceDetail(
    @Param("id") id: string,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.invoiceDetail(id, authorization),
      request.requestId,
    );
  }

  @Post("invoices/:id/issue")
  async issueInvoice(
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.finance.issueInvoice(id, idempotencyKey!, authorization),
      request.requestId,
    );
  }

  @Post("invoices/:invoiceId/payments")
  async recordPayment(
    @Param("invoiceId") invoiceId: string,
    @Body() dto: RecordFinancePaymentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.finance.recordPayment(
        invoiceId,
        dto,
        idempotencyKey!,
        authorization,
      ),
      request.requestId,
    );
  }

  @Post("invoices/:invoiceId/payments/:paymentId/corrections")
  async requestCorrection(
    @Param("invoiceId") invoiceId: string,
    @Param("paymentId") paymentId: string,
    @Body() dto: CreateFinanceCorrectionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.finance.requestCorrection(
        invoiceId,
        paymentId,
        dto,
        idempotencyKey!,
        authorization,
      ),
      request.requestId,
    );
  }

  @Get("corrections")
  async corrections(
    @Query() query: FinanceCorrectionQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.listCorrections(query, authorization),
      request.requestId,
    );
  }

  @Post("corrections/:id/approve")
  async approveCorrection(
    @Param("id") id: string,
    @Body() dto: ApproveFinanceCorrectionDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.approveCorrection(id, dto, authorization),
      request.requestId,
    );
  }

  @Post("corrections/:id/reject")
  async rejectCorrection(
    @Param("id") id: string,
    @Body() dto: RejectFinanceCorrectionDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.rejectCorrection(id, dto, authorization),
      request.requestId,
    );
  }

  @Get("reconciliation")
  async reconciliation(
    @Query() query: FinanceReconciliationQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.finance.reconciliation(query, authorization),
      request.requestId,
    );
  }

  private assertIdempotencyKey(value: string | undefined): asserts value is string {
    if (!value || value.length < 16 || value.length > 100) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_INVALID",
        message: "Idempotency-Key must be between 16 and 100 characters.",
      });
    }
  }
}

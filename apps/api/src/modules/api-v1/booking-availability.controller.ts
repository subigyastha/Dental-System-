import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import { BookingAvailabilityService } from "./booking-availability.service";
import { BookingBootstrapService } from "./booking-bootstrap.service";
import { BookingConfirmationService } from "./booking-confirmation.service";
import {
  CreateBookingSlotHoldDto,
  RankedAvailabilityQueryDto,
} from "./dto/booking-availability.dto";
import { BookingBootstrapQueryDto } from "./dto/booking-bootstrap-query.dto";
import { ConfirmBookingDto } from "./dto/booking-confirmation.dto";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/booking")
@UseFilters(V1ExceptionFilter)
export class BookingAvailabilityController {
  constructor(
    @Inject(BookingAvailabilityService)
    private readonly availability: BookingAvailabilityService,
    @Inject(BookingBootstrapService)
    private readonly booking: BookingBootstrapService,
    @Inject(BookingConfirmationService)
    private readonly confirmation: BookingConfirmationService,
  ) {}

  @Get("bootstrap")
  async bootstrap(
    @Query() query: BookingBootstrapQueryDto,
    @Req() request: { requestId?: string },
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return v1Envelope(
      await this.booking.getBootstrap(query.locationId, authorization),
      request.requestId,
    );
  }

  @Get("availability")
  async rankedAvailability(
    @Query() query: RankedAvailabilityQueryDto,
    @Req() request: { requestId?: string },
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return v1Envelope(
      await this.availability.rankedAvailability(query, authorization),
      request.requestId,
    );
  }

  @Post("holds")
  async createHold(
    @Body() dto: CreateBookingSlotHoldDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    if (
      idempotencyKey &&
      (idempotencyKey.length < 16 || idempotencyKey.length > 100)
    ) {
      throw new BadRequestException(
        "Idempotency-Key must be between 16 and 100 characters",
      );
    }
    return v1Envelope(
      await this.availability.createHold(
        idempotencyKey ? { ...dto, idempotencyKey } : dto,
        authorization,
      ),
      request.requestId,
    );
  }

  @Post("confirm")
  async confirm(
    @Body() dto: ConfirmBookingDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 100
    ) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_INVALID",
        message:
          "Idempotency-Key must be between 16 and 100 characters",
      });
    }
    return v1Envelope(
      await this.confirmation.confirm(
        dto,
        idempotencyKey,
        authorization,
      ),
      request.requestId,
    );
  }

  @Get("holds/:id")
  async getHold(
    @Param("id") id: string,
    @Req() request: { requestId?: string },
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return v1Envelope(
      await this.availability.getHold(id, authorization),
      request.requestId,
    );
  }

  @Delete("holds/:id")
  async releaseHold(
    @Param("id") id: string,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.availability.releaseHold(id, authorization),
      request.requestId,
    );
  }
}

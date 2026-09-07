import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, UseFilters } from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import {
  ArchiveClientDto,
  AppendCallerPhoneDto,
  AppendClientPhoneDto,
  ClientDirectoryQueryDto,
  ClientIdentityReviewQueryDto,
  ClientIdentityDto,
  CreateClientDto,
  MatchClientsDto,
  MergeClientDto,
  NumberFirstClientMatchDto,
  ResolveClientIdentityReviewDto,
} from "./dto/client-hub.dto";
import { ClientsV1Service } from "./clients-v1.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/clients")
@UseFilters(V1ExceptionFilter)
export class ClientsV1Controller {
  constructor(@Inject(ClientsV1Service) private readonly clients: ClientsV1Service) {}

  @Get()
  async list(
    @Query() query: ClientDirectoryQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.list(query, authorization), request.requestId);
  }

  @Post()
  async create(
    @Body() dto: CreateClientDto,
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
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key must be between 16 and 100 characters.",
      });
    }
    return v1Envelope(
      await this.clients.create(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("number-matches")
  async numberMatches(
    @Body() dto: NumberFirstClientMatchDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.numberMatches(dto, authorization), request.requestId);
  }

  @Get("identity-reviews")
  async identityReviews(
    @Query() query: ClientIdentityReviewQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.listIdentityReviews(query, authorization), request.requestId);
  }

  @Post("identity-reviews/:reviewId/resolve")
  async resolveIdentityReview(
    @Param("reviewId") reviewId: string,
    @Body() dto: ResolveClientIdentityReviewDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.clients.resolveIdentityReview(reviewId, dto, authorization),
      request.requestId,
    );
  }

  @Get(":id")
  async getOne(
    @Param("id") id: string,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.getOne(id, authorization), request.requestId);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: ClientIdentityDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.update(id, dto, authorization), request.requestId);
  }

  @Post("match")
  async match(
    @Body() dto: MatchClientsDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.match(dto, authorization), request.requestId);
  }

  @Post(":id/phones")
  async appendPhone(
    @Param("id") id: string,
    @Body() dto: AppendClientPhoneDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.appendPhone(id, dto, authorization), request.requestId);
  }

  @Post(":id/caller-phone")
  async appendCallerPhone(
    @Param("id") id: string,
    @Body() dto: AppendCallerPhoneDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.clients.appendCallerPhone(id, dto, authorization),
      request.requestId,
    );
  }

  @Post(":id/archive")
  async archive(
    @Param("id") id: string,
    @Body() dto: ArchiveClientDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(await this.clients.archive(id, dto.reason, authorization), request.requestId);
  }

  @Post(":id/merge")
  async merge(
    @Param("id") id: string,
    @Body() dto: MergeClientDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.clients.merge(id, dto.secondaryClientId, dto.reason, authorization),
      request.requestId,
    );
  }
}

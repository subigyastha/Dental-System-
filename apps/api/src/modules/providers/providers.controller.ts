import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { ServiceSession } from "../auth/request-session";

import { CreateProviderDto } from "./dto/create-provider.dto";
import { UpdateProviderDto } from "./dto/update-provider.dto";
import {
  AvailabilityWindowDto,
  BlockedTimeDto,
  RecurringBlockDto,
  UpdateProviderScheduleDto,
} from "./dto/update-provider-schedule.dto";
import { ListProviderScheduleGridDto } from "./dto/list-provider-schedule-grid.dto";
import { ListProviderScheduleGridsDto } from "./dto/list-provider-schedule-grids.dto";
import { ListProviderSlotsDto } from "./dto/list-provider-slots.dto";
import { ProvidersService } from "./providers.service";

@Controller("providers")
export class ProvidersController {
  constructor(
    @Inject(ProvidersService)
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  list(@ServiceSession() authorization?: string) {
    return this.providers.list(authorization);
  }

  @Get("schedule-grid")
  listScheduleGrids(
    @Query() query: ListProviderScheduleGridsDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.listScheduleGrids(query, authorization);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.providers.getOne(id, authorization);
  }

  @Post()
  create(
    @Body() dto: CreateProviderDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.create(dto, authorization);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.providers.remove(id, authorization);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProviderDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.update(id, dto, authorization);
  }

  @Get(":id/schedule")
  getSchedule(
    @Param("id") id: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.getSchedule(id, authorization);
  }

  @Get(":id/slots")
  listSlots(
    @Param("id") id: string,
    @Query() query: ListProviderSlotsDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.listSlots(id, query, authorization);
  }

  @Get(":id/schedule-grid")
  listScheduleGrid(
    @Param("id") id: string,
    @Query() query: ListProviderScheduleGridDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.listScheduleGrid(id, query, authorization);
  }

  @Patch(":id/schedule")
  updateSchedule(
    @Param("id") id: string,
    @Body() dto: UpdateProviderScheduleDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.updateSchedule(id, dto, authorization);
  }

  @Post(":id/recurring-blocks")
  createRecurringBlock(
    @Param("id") id: string,
    @Body() body: { organizationId: string; entry: RecurringBlockDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.createRecurringBlock(
      id,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Patch(":id/recurring-blocks/:entryId")
  updateRecurringBlock(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string; entry: RecurringBlockDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.updateRecurringBlock(
      id,
      entryId,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Delete(":id/recurring-blocks/:entryId")
  deleteRecurringBlock(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.deleteRecurringBlock(
      id,
      entryId,
      body.organizationId,
      authorization,
    );
  }

  @Post(":id/availability")
  createAvailabilityEntry(
    @Param("id") id: string,
    @Body() body: { organizationId: string; entry: AvailabilityWindowDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.createAvailabilityEntry(
      id,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Patch(":id/availability/:entryId")
  updateAvailabilityEntry(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string; entry: AvailabilityWindowDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.updateAvailabilityEntry(
      id,
      entryId,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Delete(":id/availability/:entryId")
  deleteAvailabilityEntry(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.deleteAvailabilityEntry(
      id,
      entryId,
      body.organizationId,
      authorization,
    );
  }

  @Post(":id/blocked-times")
  createBlockedTime(
    @Param("id") id: string,
    @Body() body: { organizationId: string; entry: BlockedTimeDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.createBlockedTime(
      id,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Patch(":id/blocked-times/:entryId")
  updateBlockedTime(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string; entry: BlockedTimeDto },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.updateBlockedTime(
      id,
      entryId,
      body.organizationId,
      body.entry,
      authorization,
    );
  }

  @Delete(":id/blocked-times/:entryId")
  deleteBlockedTime(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() body: { organizationId: string },
    @ServiceSession() authorization?: string,
  ) {
    return this.providers.deleteBlockedTime(
      id,
      entryId,
      body.organizationId,
      authorization,
    );
  }
}

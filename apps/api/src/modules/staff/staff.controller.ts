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

import { CreateStaffDto } from "./dto/create-staff.dto";
import { ResetStaffPasswordDto } from "./dto/reset-staff-password.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { StaffService } from "./staff.service";

@Controller("staff")
export class StaffController {
  constructor(
    @Inject(StaffService)
    private readonly staff: StaffService,
  ) {}

  @Get()
  list(
    @Query("includeInactive") includeInactive?: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.staff.list(includeInactive === "true", authorization);
  }

  @Get(":id")
  getOne(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.staff.getOne(id, authorization);
  }

  @Post()
  create(
    @Body() dto: CreateStaffDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.staff.create(dto, authorization);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateStaffDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.staff.update(id, dto, authorization);
  }

  @Patch(":id/password")
  resetPassword(
    @Param("id") id: string,
    @Body() dto: ResetStaffPasswordDto,
    @ServiceSession() authorization?: string,
  ) {
    return this.staff.resetPassword(id, dto, authorization);
  }

  @Delete(":id")
  deactivate(
    @Param("id") id: string,
    @ServiceSession() authorization?: string,
  ) {
    return this.staff.deactivate(id, authorization);
  }

  @Patch(":id/restore")
  restore(@Param("id") id: string, @ServiceSession() authorization?: string) {
    return this.staff.restore(id, authorization);
  }
}

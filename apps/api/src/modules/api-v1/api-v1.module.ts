import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { ProvidersModule } from "../providers/providers.module";
import { BookingAvailabilityController } from "./booking-availability.controller";
import { BookingAvailabilityService } from "./booking-availability.service";
import { BookingBootstrapService } from "./booking-bootstrap.service";
import { BookingConfirmationService } from "./booking-confirmation.service";
import { DashboardV1Controller } from "./dashboard-v1.controller";
import { DashboardBootstrapService } from "./dashboard-bootstrap.service";
import { FinanceLedgerService } from "./finance-ledger.service";
import { FinanceV1Controller } from "./finance-v1.controller";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { ClientsV1Controller } from "./clients-v1.controller";
import { ClientsV1Service } from "./clients-v1.service";
import { WorkspaceV1Controller } from "./workspace-v1.controller";
import { WorkspaceBootstrapService } from "./workspace-bootstrap.service";
import { ScheduleBootstrapService } from "./schedule-bootstrap.service";
import { ScheduleV1Controller } from "./schedule-v1.controller";
import { StaffDirectoryService } from "./staff-directory.service";
import { StaffV1Controller } from "./staff-v1.controller";
import { ClinicSettingsController } from "./clinic-settings.controller";
import { ClinicSettingsService } from "./clinic-settings.service";

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    SchedulingModule,
    AppointmentsModule,
    ProvidersModule,
  ],
  controllers: [
    BookingAvailabilityController,
    DashboardV1Controller,
    ClientsV1Controller,
    FinanceV1Controller,
    InventoryController,
    ScheduleV1Controller,
    StaffV1Controller,
    ClinicSettingsController,
    WorkspaceV1Controller,
  ],
  providers: [
    BookingAvailabilityService,
    BookingBootstrapService,
    BookingConfirmationService,
    DashboardBootstrapService,
    ClientsV1Service,
    FinanceLedgerService,
    InventoryService,
    ScheduleBootstrapService,
    StaffDirectoryService,
    ClinicSettingsService,
    WorkspaceBootstrapService,
  ],
})
export class ApiV1Module {}

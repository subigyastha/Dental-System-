import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";

import { monorepoRoot } from "./env-bootstrap";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { ApiV1Module } from "./modules/api-v1/api-v1.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { FollowupsModule } from "./modules/followups/followups.module";
import { HealthModule } from "./modules/health/health.module";
import { OperationalDataModule } from "./modules/operational-data/operational-data.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { StaffModule } from "./modules/staff/staff.module";
import { SystemModule } from "./modules/system/system.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [
        join(monorepoRoot, ".env.local"),
        join(monorepoRoot, ".env"),
      ],
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    ApiV1Module,
    HealthModule,
    SystemModule,
    OperationalDataModule,
    AppointmentsModule,
    BillingModule,
    CustomersModule,
    CommunicationsModule,
    FollowupsModule,
    OrganizationsModule,
    ProvidersModule,
    PlatformModule,
    SchedulingModule,
    StaffModule,
  ],
})
export class AppModule {}

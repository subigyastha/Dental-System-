import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";

import { monorepoRoot } from "./env-bootstrap";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { FollowupsModule } from "./modules/followups/followups.module";
import { OperationalDataModule } from "./modules/operational-data/operational-data.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProvidersModule } from "./modules/providers/providers.module";
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
    SystemModule,
    OperationalDataModule,
    AppointmentsModule,
    BillingModule,
    CustomersModule,
    CommunicationsModule,
    FollowupsModule,
    OrganizationsModule,
    ProvidersModule,
    SchedulingModule,
    StaffModule,
  ],
})
export class AppModule {}

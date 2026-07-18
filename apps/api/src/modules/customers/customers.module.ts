import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CustomersController } from "./customers.controller";
import { CustomerArchiveService } from "./customer-archive.service";
import { CustomersService } from "./customers.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerArchiveService],
})
export class CustomersModule {}

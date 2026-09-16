import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";

import { AuthController } from "./auth.controller";
import { AuthorizationPolicyService } from "./authorization-policy.service";
import { RoleGovernanceController } from "./role-governance.controller";
import { RoleGovernanceService } from "./role-governance.service";
import { AuthService } from "./auth.service";
import { CsrfGuard } from "./csrf.guard";
import { SessionAuthGuard } from "./session-auth.guard";

@Module({
  controllers: [AuthController, RoleGovernanceController],
  providers: [
    Reflector,
    AuthService,
    AuthorizationPolicyService,
    RoleGovernanceService,
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
  exports: [AuthService, AuthorizationPolicyService],
})
export class AuthModule {}

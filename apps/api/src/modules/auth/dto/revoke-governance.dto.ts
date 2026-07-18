import { IsString } from "class-validator";

export class RevokeGovernanceDto {
  @IsString()
  reason!: string;
}

import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateFollowupDto {
  @IsIn(["Done", "Open"])
  status!: "Done" | "Open";

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAtIso?: string;

  @IsString()
  @MaxLength(2000)
  outcome!: string;
}

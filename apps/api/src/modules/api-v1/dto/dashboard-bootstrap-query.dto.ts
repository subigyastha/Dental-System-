import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** The bootstrap is a bounded snapshot, not a general-purpose data export. */
export class DashboardBootstrapQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit = 12;
}

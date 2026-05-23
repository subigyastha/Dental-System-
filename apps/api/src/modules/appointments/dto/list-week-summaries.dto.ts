import { IsOptional, IsString } from "class-validator";

export class ListWeekSummariesDto {
  @IsString()
  fromDateKey!: string;

  @IsString()
  toDateKey!: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}

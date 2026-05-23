import { IsOptional, IsString } from "class-validator";

export class ListDaySummariesDto {
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

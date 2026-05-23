import {
  IsObject,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
} from "class-validator";

export class UpsertVisitReportDto {
  @IsString()
  organizationId!: string;

  @IsString()
  appointmentId!: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsString()
  providerId!: string;

  @IsString()
  visitSummary!: string;

  @IsOptional()
  @IsString()
  symptoms?: string;

  @IsOptional()
  @IsString()
  clinicalNotes?: string;

  @IsOptional()
  @IsString()
  doctorNotes?: string;

  @IsBoolean()
  followUpRequired!: boolean;

  @IsOptional()
  @IsISO8601()
  followUpDateIso?: string;

  @IsBoolean()
  updateDentalChart!: boolean;

  @IsOptional()
  @IsObject()
  chartData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  chartNote?: string;
}

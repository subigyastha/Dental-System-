import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min, MaxLength, MinLength } from "class-validator";
import { Type } from "class-transformer";

export class FollowupClientsDto {
  @IsOptional() @IsIn(["recent", "all", "not_contacted"]) view?: "recent" | "all" | "not_contacted";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) uncontactedDays?: number;
  @IsOptional() @IsString() @MaxLength(100) query?: string;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsOptional() @IsString() @MaxLength(100) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) cursor?: string;
}

export class StaffFollowupDto {
  @IsIn(["log", "schedule"]) action!: "log" | "schedule";
  @IsString() @MinLength(1) @MaxLength(100) requestId!: string;
  @IsOptional() @IsString() @MaxLength(100) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) taskId?: string;
  @IsOptional() @IsISO8601({ strict: true }) expectedUpdatedAtIso?: string;
  @IsOptional() @IsIn(["reached", "no_answer"]) result?: "reached" | "no_answer";
  @IsOptional() @IsIn(["call", "whatsapp", "sms", "email", "in_person", "other", "unknown"]) channel?: string;
  @IsOptional() @IsIn(["inbound", "outbound"]) direction?: "inbound" | "outbound";
  @IsOptional() @IsString() @MaxLength(2000) responseText?: string;
  @IsOptional() @IsISO8601({ strict: true }) occurredAtIso?: string;
  @IsOptional() @IsISO8601({ strict: true }) dueAtIso?: string;
  @IsOptional() @IsBoolean() dateOnly?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

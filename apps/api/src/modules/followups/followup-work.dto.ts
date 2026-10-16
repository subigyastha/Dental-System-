import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const responseLabels = {
  reached: "Spoke to client",
  no_answer: "No answer",
  contact_later: "Asked to contact later",
  appointment_needed: "Appointment needed",
  provider_attention: "Needs provider attention",
  not_needed: "Follow-up not needed",
  reschedule: "Follow-up date changed",
} as const;

export class LogFollowupDto {
  @IsIn(Object.keys(responseLabels))
  response!: keyof typeof responseLabels;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requestId!: string;

  @IsISO8601({ strict: true })
  expectedUpdatedAtIso!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  nextContactAtIso?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  nextRecallAtIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class FollowupQueueDto {
  @IsOptional()
  @IsIn(["post_visit"])
  purpose?: "post_visit";

  @IsOptional()
  @IsIn(["all", "attention", "upcoming", "done", "today", "overdue", "future"])
  view?: "all" | "attention" | "upcoming" | "done" | "today" | "overdue" | "future";

  @IsOptional()
  @IsIn(["Open", "InProgress", "Waiting", "Blocked", "Done"])
  status?: "Open" | "InProgress" | "Waiting" | "Blocked" | "Done";

  @IsOptional()
  @IsIn(["due", "client", "status", "updated"])
  sort?: "due" | "client" | "status" | "updated";

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";

  @IsOptional()
  @IsIn(["today", "overdue", "future"])
  period?: "today" | "overdue" | "future";

  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  appointmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

export class FollowupHistoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

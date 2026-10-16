import { IsString, MaxLength, MinLength } from "class-validator";
import { IsAdDateKey } from "../scheduling/ad-date-key";

export class CreateProcedureReviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  appointmentId!: string;

  @IsAdDateKey()
  dueDate!: string;

  @IsString()
  @MaxLength(200)
  summary!: string;

  @IsString()
  @MaxLength(2000)
  nextAction!: string;
}

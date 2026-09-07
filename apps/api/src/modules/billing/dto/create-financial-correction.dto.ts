import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateFinancialCorrectionDto {
  @IsString()
  organizationId!: string;

  @IsIn(["Refund", "Reversal"])
  kind!: "Refund" | "Reversal";

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  providerReference?: string;
}

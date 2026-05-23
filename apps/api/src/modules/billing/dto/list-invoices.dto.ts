import { IsIn, IsOptional, IsString } from "class-validator";

export class ListInvoicesDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsIn(["Draft", "Issued", "PartiallyPaid", "Paid", "Cancelled", "Void"])
  status?: string;
}

import { IsString } from "class-validator";

export class VoidInvoiceDto {
  @IsString()
  organizationId!: string;

  @IsString()
  reason!: string;
}

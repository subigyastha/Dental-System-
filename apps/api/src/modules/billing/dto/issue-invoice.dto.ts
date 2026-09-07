import { IsString } from "class-validator";

export class IssueInvoiceDto {
  @IsString()
  organizationId!: string;
}

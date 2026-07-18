import { IsString } from "class-validator";

export class ArchiveCustomerDto {
  @IsString()
  reason!: string;
}

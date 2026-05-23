import { IsString } from "class-validator";

export class CreateCommunicationDto {
  @IsString()
  appointmentId!: string;

  @IsString()
  customerId!: string;

  @IsString()
  channel!: string;

  @IsString()
  direction!: string;

  @IsString()
  summary!: string;
}

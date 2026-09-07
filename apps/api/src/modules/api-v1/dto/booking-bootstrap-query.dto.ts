import { IsString, MinLength } from "class-validator";

export class BookingBootstrapQueryDto {
  @IsString()
  @MinLength(1)
  locationId!: string;
}

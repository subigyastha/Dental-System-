import { IsString } from "class-validator";

export class RevokeSupportAccessGrantDto {
  @IsString()
  reason!: string;
}

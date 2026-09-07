import { MinLength } from "class-validator";

import { PasswordDto, StaffBaseDto } from "./staff-base.dto";

export class CreateStaffDto extends StaffBaseDto {
  @MinLength(15)
  password!: PasswordDto["password"];
}

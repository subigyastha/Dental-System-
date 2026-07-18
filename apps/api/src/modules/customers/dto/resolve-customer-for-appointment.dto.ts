import { IsIn, IsOptional, IsString } from "class-validator";

import { CustomerBaseDto } from "./customer-base.dto";

export class ResolveCustomerForAppointmentDto extends CustomerBaseDto {
  @IsString()
  organizationId!: string;

  @IsIn(["use_existing", "update_existing", "create_new"])
  mode!: "use_existing" | "update_existing" | "create_new";

  @IsOptional()
  @IsString()
  existingCustomerId?: string;
}

import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from "class-validator";

export class CustomerBaseDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  patientCode?: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirthIso?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  allergies?: string;

  @IsOptional()
  @IsString()
  medicalNotes?: string;

  @IsIn(["Routine", "Needs attention", "High priority"])
  risk!: "Routine" | "Needs attention" | "High priority";
}

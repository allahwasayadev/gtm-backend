import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength, IsArray, ArrayMinSize } from 'class-validator';
import { UserRole } from '@prisma/client';

export class SignupDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one role is required' })
  @IsEnum(UserRole, {
    each: true,
    message: 'Each role must be Admin, OEM, or Reseller',
  })
  roles: UserRole[];
}

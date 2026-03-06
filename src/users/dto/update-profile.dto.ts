import { IsEmail, IsEnum, IsOptional, IsString, MinLength, IsArray } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, {
    each: true,
    message: 'Each role must be Admin, OEM, or Reseller',
  })
  roles?: UserRole[];

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

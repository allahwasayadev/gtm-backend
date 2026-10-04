import {
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
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

  /**
   * REQUIRED. The activation code is sent here by SMS and there is no email
   * or voice alternative, so an account cannot be created without it.
   */
  @IsNotEmpty({ message: 'A mobile number is required to verify your account' })
  @IsString()
  phoneNumber: string;

  /**
   * SMS consent (A2P 10DLC). Must be true: the activation code is only
   * deliverable by SMS, so an account cannot be created without agreeing to
   * receive it. An SmsConsentEvent is still written with the timestamp,
   * source and verbatim wording shown, which is the compliance record.
   *
   * !! This makes consent a condition of creating an account. The currently
   * approved campaign states the opposite. See sms-consent.constants.ts.
   */
  @IsBoolean()
  @Equals(true, {
    message:
      'You must agree to receive SMS verification codes to create an account',
  })
  smsConsent: boolean;
}

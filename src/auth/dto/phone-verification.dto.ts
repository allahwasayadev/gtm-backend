import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/**
 * Activation is authorised by a short-lived, scope-limited token issued at
 * signup or by a password-correct login. It is never keyed on an email
 * address: knowing one must not grant any power over that account.
 */
export class ActivationTokenDto {
  @IsNotEmpty()
  @IsString()
  activationToken: string;
}

export class SetActivationPhoneDto extends ActivationTokenDto {
  @IsNotEmpty({ message: 'A mobile number is required to verify your account' })
  @IsString()
  phoneNumber: string;
}

export class VerifyActivationDto extends ActivationTokenDto {
  @IsString()
  @Length(6, 6, { message: 'Enter the 6-digit code' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

import { IsEmail, IsString, Length, Matches } from 'class-validator';

/** Activation: the email just used to sign up, plus the code from the handset. */
export class VerifySignupPhoneDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6, { message: 'Enter the 6-digit code' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class ResendSignupPhoneDto {
  @IsEmail()
  email: string;
}

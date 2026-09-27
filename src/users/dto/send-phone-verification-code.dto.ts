import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class SendPhoneVerificationCodeDto {
  @IsString()
  @MinLength(8)
  phoneNumber!: string;

  /**
   * SMS consent captured on the profile screen. Required before a first send
   * to a number that has no consent on record; ignored if consent already
   * exists for this user.
   */
  @IsOptional()
  @IsBoolean()
  smsConsent?: boolean;
}

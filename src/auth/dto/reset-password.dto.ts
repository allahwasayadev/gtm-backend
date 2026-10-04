import { IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';

/**
 * Reset is completed with a 6-digit code sent to the account's VERIFIED phone.
 * There is no emailed token or link in this flow any more.
 */
export class ResetPasswordDto {
  @IsNotEmpty({ message: 'Enter your email address or mobile number' })
  @IsString()
  identifier: string;

  @IsString()
  @Length(6, 6, { message: 'Enter the 6-digit code' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}

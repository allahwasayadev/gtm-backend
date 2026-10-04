import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Reset may start from an email address OR a mobile number, so the field is a
 * free-form identifier rather than @IsEmail. Validating it as an email would
 * reject phone numbers, and a type-specific rejection is itself a disclosure.
 */
export class ForgotPasswordDto {
  @IsNotEmpty({ message: 'Enter your email address or mobile number' })
  @IsString()
  identifier: string;
}

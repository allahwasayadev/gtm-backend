import { IsString, MinLength } from 'class-validator';

export class SendPhoneVerificationCodeDto {
  @IsString()
  @MinLength(8)
  phoneNumber!: string;
}

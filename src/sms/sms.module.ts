import { Global, Module } from '@nestjs/common';
import { TwilioSmsService } from './twilio-sms.service';

@Global()
@Module({
  providers: [TwilioSmsService],
  exports: [TwilioSmsService],
})
export class SmsModule {}

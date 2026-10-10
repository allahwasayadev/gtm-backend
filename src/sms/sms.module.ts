import { Global, Module } from '@nestjs/common';
import { TwilioSmsService } from './twilio-sms.service';
import { SmsWebhookService } from './sms-webhook.service';
import { SmsConsentService } from './sms-consent.service';
import { SmsController } from './sms.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SmsController],
  providers: [TwilioSmsService, SmsWebhookService, SmsConsentService],
  exports: [TwilioSmsService, SmsWebhookService, SmsConsentService],
})
export class SmsModule {}

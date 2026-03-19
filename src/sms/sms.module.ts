import { Global, Module } from '@nestjs/common';
import { TwilioSmsService } from './twilio-sms.service';
import { SmsWebhookService } from './sms-webhook.service';
import { SmsController } from './sms.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SmsController],
  providers: [TwilioSmsService, SmsWebhookService],
  exports: [TwilioSmsService, SmsWebhookService],
})
export class SmsModule {}

import {
  Controller,
  Post,
  Body,
  HttpCode,
  Header,
  UseGuards,
} from '@nestjs/common';
import { SmsWebhookService } from './sms-webhook.service';
import { TwilioSignatureGuard } from './twilio-signature.guard';

/**
 * Twilio sends inbound webhooks as application/x-www-form-urlencoded.
 * NestJS (Express) parses this by default.
 */
@Controller('sms')
export class SmsController {
  constructor(private smsWebhookService: SmsWebhookService) {}

  /**
   * Twilio inbound SMS webhook.
   * Handles STOP/START/HELP keyword replies as required by A2P 10DLC.
   * Guarded by X-Twilio-Signature: this endpoint mutates consent state, so an
   * unsigned request must never be honoured.
   */
  @UseGuards(TwilioSignatureGuard)
  @Post('inbound')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleInbound(@Body() body: Record<string, string>): Promise<string> {
    const from = body.From ?? '';
    const text = (body.Body ?? '').trim();

    await this.smsWebhookService.handleInbound(from, text);

    // Return empty TwiML — we send keyword replies via the API
    return '<Response></Response>';
  }
}

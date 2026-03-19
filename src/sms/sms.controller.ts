import { Controller, Post, Body, HttpCode, Header } from '@nestjs/common';
import { SmsWebhookService } from './sms-webhook.service';

/**
 * Twilio sends inbound webhooks as application/x-www-form-urlencoded.
 * NestJS (Express) parses this by default.
 */
@Controller('sms')
export class SmsController {
  constructor(private smsWebhookService: SmsWebhookService) {}

  /**
   * Twilio inbound SMS webhook.
   * Handles STOP/HELP keyword replies as required by A2P 10DLC.
   */
  @Post('inbound')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleInbound(
    @Body() body: Record<string, string>,
  ): Promise<string> {
    const from = body.From ?? '';
    const text = (body.Body ?? '').trim();

    await this.smsWebhookService.handleInbound(from, text);

    // Return empty TwiML — we send keyword replies via the API
    return '<Response></Response>';
  }
}

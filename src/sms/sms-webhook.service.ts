import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TwilioSmsService } from './twilio-sms.service';

const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const HELP_KEYWORDS = ['HELP'];

@Injectable()
export class SmsWebhookService {
  private readonly logger = new Logger(SmsWebhookService.name);

  constructor(
    private prisma: PrismaService,
    private twilioSmsService: TwilioSmsService,
  ) {}

  async handleInbound(from: string, text: string): Promise<void> {
    if (!from) return;

    const upperText = text.toUpperCase().trim();

    if (STOP_KEYWORDS.includes(upperText)) {
      await this.handleStop(from);
      return;
    }

    if (HELP_KEYWORDS.includes(upperText)) {
      await this.handleHelp(from);
      return;
    }
  }

  private async handleStop(phoneNumber: string): Promise<void> {
    this.logger.log(`STOP received from ${phoneNumber}`);

    // Mark all users with this phone number as opted out
    await this.prisma.user.updateMany({
      where: { phoneNumber },
      data: { smsOptedOut: true },
    });

    try {
      await this.twilioSmsService.sendSms(
        phoneNumber,
        'You are unsubscribed and will no longer receive messages.',
      );
    } catch (error) {
      // Twilio may block sends to opted-out numbers; that's expected
      this.logger.warn(
        `Failed to send STOP confirmation to ${phoneNumber}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async handleHelp(phoneNumber: string): Promise<void> {
    this.logger.log(`HELP received from ${phoneNumber}`);

    try {
      await this.twilioSmsService.sendSms(
        phoneNumber,
        'Ovrlap support: support@ovrlap.app',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send HELP response to ${phoneNumber}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

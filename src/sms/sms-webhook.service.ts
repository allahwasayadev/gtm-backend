import { Injectable, Logger } from '@nestjs/common';
import { TwilioSmsService } from './twilio-sms.service';
import { SmsConsentService } from './sms-consent.service';
import { SmsConsentSource } from './sms-consent.constants';

/**
 * CTIA-standard keywords. Twilio's Advanced Opt-Out also handles these at its
 * edge; we mirror them so our own consent record never disagrees with Twilio's.
 */
const STOP_KEYWORDS = [
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPTOUT',
  'OPT-OUT',
];
const START_KEYWORDS = ['START', 'UNSTOP', 'YES', 'RESUME', 'OPTIN', 'OPT-IN'];
const HELP_KEYWORDS = ['HELP', 'INFO'];

/** Brand-identified replies, as required for A2P 10DLC. */
const STOP_REPLY =
  'Ovrlap: You are unsubscribed from Ovrlap account verification messages ' +
  'and will receive no further texts. Reply START to resubscribe. ' +
  'Reply HELP for help.';

const START_REPLY =
  'Ovrlap: You are resubscribed to Ovrlap account verification messages. ' +
  'Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, ' +
  'HELP for help.';

const HELP_REPLY =
  'Ovrlap account verification. Support: support@ovrlap.app. ' +
  'Msg frequency varies. Msg & data rates may apply. ' +
  'Reply STOP to unsubscribe.';

@Injectable()
export class SmsWebhookService {
  private readonly logger = new Logger(SmsWebhookService.name);

  constructor(
    private twilioSmsService: TwilioSmsService,
    private smsConsentService: SmsConsentService,
  ) {}

  async handleInbound(from: string, text: string): Promise<void> {
    if (!from) return;

    const keyword = this.extractKeyword(text);
    if (!keyword) return;

    if (STOP_KEYWORDS.includes(keyword)) {
      await this.handleStop(from);
      return;
    }

    if (START_KEYWORDS.includes(keyword)) {
      await this.handleStart(from);
      return;
    }

    if (HELP_KEYWORDS.includes(keyword)) {
      await this.handleHelp(from);
      return;
    }
  }

  /**
   * Take the first word and strip surrounding punctuation, so "STOP.",
   * "stop please" and "Stop!" all resolve to STOP. An exact-match check
   * silently missed these and left our record out of step with Twilio's.
   */
  private extractKeyword(text: string): string | null {
    const first = text.trim().split(/\s+/)[0] ?? '';
    const cleaned = first.replace(/^[^A-Za-z-]+|[^A-Za-z-]+$/g, '');
    return cleaned ? cleaned.toUpperCase() : null;
  }

  private async handleStop(phoneNumber: string): Promise<void> {
    this.logger.log('STOP received; revoking consent for the sending number');

    await this.smsConsentService.recordOptOut(
      phoneNumber,
      SmsConsentSource.SmsKeyword,
    );

    await this.safeReply(phoneNumber, STOP_REPLY, 'STOP confirmation');
  }

  private async handleStart(phoneNumber: string): Promise<void> {
    this.logger.log('START received; restoring consent for the sending number');

    await this.smsConsentService.recordResubscribe(
      phoneNumber,
      SmsConsentSource.SmsKeyword,
    );

    await this.safeReply(phoneNumber, START_REPLY, 'START confirmation');
  }

  private async handleHelp(phoneNumber: string): Promise<void> {
    this.logger.log('HELP received');
    await this.safeReply(phoneNumber, HELP_REPLY, 'HELP reply');
  }

  private async safeReply(
    phoneNumber: string,
    message: string,
    label: string,
  ): Promise<void> {
    try {
      await this.twilioSmsService.sendSms(phoneNumber, message);
    } catch (error) {
      // Twilio blocks sends to opted-out numbers; for STOP that is expected,
      // since Advanced Opt-Out will have sent its own confirmation.
      this.logger.warn(
        `Failed to send ${label}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

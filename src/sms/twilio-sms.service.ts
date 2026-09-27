import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { getTwilioSmsConfig, TwilioSmsConfig } from './twilio.config';
import { isTestNumber } from './sms-test-mode';

@Injectable()
export class TwilioSmsService {
  private readonly logger = new Logger(TwilioSmsService.name);

  async sendVerificationCode(phoneNumber: string, code: string): Promise<void> {
    // Allow-listed test numbers never reach Twilio. The code is still stored,
    // hashed and checked on submission — see sms-test-mode.ts.
    if (isTestNumber(phoneNumber)) {
      this.logger.warn(
        `[SMS TEST MODE] Suppressed outbound verification SMS to an ` +
          `allow-listed test number. The code is still verified normally.`,
      );
      return;
    }

    await this.dispatch(
      phoneNumber,
      `Ovrlap: Your verification code is ${code}. It expires in 10 minutes. ` +
        `Do not share this code. Reply STOP to opt out, HELP for help.`,
      { throwOnFailure: true },
    );
  }

  async sendSms(phoneNumber: string, message: string): Promise<void> {
    if (isTestNumber(phoneNumber)) {
      this.logger.warn(
        '[SMS TEST MODE] Suppressed outbound SMS to an allow-listed test number.',
      );
      return;
    }
    await this.dispatch(phoneNumber, message, { throwOnFailure: false });
  }

  private async dispatch(
    phoneNumber: string,
    message: string,
    opts: { throwOnFailure: boolean },
  ): Promise<void> {
    const config = getTwilioSmsConfig();
    this.assertConfigured(config);

    const body = new URLSearchParams();
    body.set('To', phoneNumber);
    body.set('Body', message);
    if (config.messagingServiceSid) {
      body.set('MessagingServiceSid', config.messagingServiceSid);
    } else if (config.fromPhoneNumber) {
      body.set('From', config.fromPhoneNumber);
    }

    const authHeader = Buffer.from(
      `${config.accountSid}:${config.authToken}`,
    ).toString('base64');

    const response = await fetch(
      `${config.apiBaseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Twilio SMS send failed (${response.status}): ${errorText.slice(0, 500)}`,
      );
      if (opts.throwOnFailure) {
        throw new InternalServerErrorException(
          'Failed to send verification code via SMS',
        );
      }
    }
  }

  private assertConfigured(config: TwilioSmsConfig): void {
    if (
      !config.accountSid ||
      !config.authToken ||
      (!config.fromPhoneNumber && !config.messagingServiceSid)
    ) {
      throw new InternalServerErrorException(
        'Twilio SMS service is not configured',
      );
    }
  }
}

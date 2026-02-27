import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { getTwilioSmsConfig } from './twilio.config';

@Injectable()
export class TwilioSmsService {
  private readonly logger = new Logger(TwilioSmsService.name);

  async sendVerificationCode(phoneNumber: string, code: string): Promise<void> {
    const config = getTwilioSmsConfig();

    if (
      !config.accountSid ||
      !config.authToken ||
      (!config.fromPhoneNumber && !config.messagingServiceSid)
    ) {
      throw new InternalServerErrorException(
        'Twilio SMS service is not configured',
      );
    }

    const body = new URLSearchParams();
    body.set('To', phoneNumber);
    body.set(
      'Body',
      `Your OvrLap verification code is ${code}. It expires in 10 minutes.`,
    );
    if (config.messagingServiceSid) {
      body.set('MessagingServiceSid', config.messagingServiceSid);
    } else if (config.fromPhoneNumber) {
      body.set('From', config.fromPhoneNumber);
    }

    const authHeader = Buffer.from(
      `${config.accountSid}:${config.authToken}`,
    ).toString('base64');

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
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
      throw new InternalServerErrorException(
        'Failed to send verification code via SMS',
      );
    }
  }
}

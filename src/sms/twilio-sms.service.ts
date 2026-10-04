import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { getTwilioSmsConfig, TwilioSmsConfig } from './twilio.config';
import { isTestNumber } from './sms-test-mode';
import { isUsableIdentifier, isUsableSecret } from './twilio-credentials';

/**
 * Outgoing message templates.
 *
 * Deliberately short: brand, code, expiry. No URL — a link in a verification
 * message trains users to click links in texts, and TCR treats embedded links
 * in a 2FA campaign as a risk factor.
 *
 * NOTE: these no longer carry "Reply STOP to opt out, HELP for help", which
 * the approved campaign's sample messages DO carry. Twilio's Advanced Opt-Out
 * still answers STOP and HELP on the inbound side, so opt-out continues to
 * work — but live traffic now differs from the approved samples. The campaign
 * description and samples must be updated and accepted before these ship.
 */
export function verificationCodeMessage(code: string): string {
  return `Ovrlap: Your verification code is ${code}. It expires in 10 minutes.`;
}

export function passwordResetCodeMessage(code: string): string {
  return `Ovrlap: Your password reset code is ${code}. It expires in 10 minutes.`;
}

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

    await this.dispatch(phoneNumber, verificationCodeMessage(code), {
      throwOnFailure: true,
    });
  }

  /**
   * Password reset code.
   *
   * Only ever sent to a number the account has already VERIFIED, and only
   * after assertMaySend() has cleared consent and opt-out state.
   */
  async sendPasswordResetCode(
    phoneNumber: string,
    code: string,
  ): Promise<void> {
    if (isTestNumber(phoneNumber)) {
      this.logger.warn(
        `[SMS TEST MODE] Suppressed outbound reset SMS to an allow-listed ` +
          `test number. The code is still verified normally.`,
      );
      return;
    }

    await this.dispatch(phoneNumber, passwordResetCodeMessage(code), {
      throwOnFailure: true,
    });
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
    // Placeholder values (production has shipped the literal "none") must be
    // treated as unconfigured. Otherwise the app builds a request against
    // /Accounts/none/Messages.json and reports a confusing upstream failure
    // instead of an honest configuration error.
    const hasSender =
      isUsableIdentifier(config.messagingServiceSid) ||
      isUsableIdentifier(config.fromPhoneNumber);

    if (
      !isUsableIdentifier(config.accountSid) ||
      !isUsableSecret(config.authToken) ||
      !hasSender
    ) {
      this.logger.error(
        'Twilio SMS is not configured: one or more credentials are missing ' +
          'or set to a placeholder value.',
      );
      throw new InternalServerErrorException(
        'Twilio SMS service is not configured',
      );
    }
  }
}

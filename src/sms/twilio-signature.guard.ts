import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { getTwilioSmsConfig } from './twilio.config';

/** The subset of the inbound request the signature covers. */
type SignedRequest = Omit<Request, 'body'> & {
  body?: Record<string, unknown>;
};

/**
 * Validates Twilio's X-Twilio-Signature on inbound webhooks.
 *
 * Without this, anyone can POST a forged STOP and opt an arbitrary number out
 * of its own account-security messages, or make the account emit replies.
 *
 * Twilio's scheme: HMAC-SHA1 over the full request URL with every POST
 * parameter appended in lexicographic key order, keyed by the auth token,
 * base64-encoded.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<SignedRequest>();
    const { authToken } = getTwilioSmsConfig();

    if (!authToken) {
      // Fail closed. An unvalidatable webhook is worse than a rejected one.
      this.logger.error(
        'Inbound SMS webhook rejected: TWILIO_AUTH_TOKEN is not configured, ' +
          'so the signature cannot be validated.',
      );
      throw new ForbiddenException('Webhook signature validation unavailable');
    }

    const signature = req.headers['x-twilio-signature'];
    if (typeof signature !== 'string' || !signature) {
      this.logger.warn('Inbound SMS webhook rejected: missing signature');
      throw new ForbiddenException('Missing Twilio signature');
    }

    const url = this.rebuildUrl(req);
    const params = req.body ?? {};

    const payload =
      url +
      Object.keys(params)
        .sort()
        .map((k) => k + String(params[k]))
        .join('');

    const expected = crypto
      .createHmac('sha1', authToken)
      .update(Buffer.from(payload, 'utf-8'))
      .digest('base64');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn('Inbound SMS webhook rejected: signature mismatch');
      throw new ForbiddenException('Invalid Twilio signature');
    }

    return true;
  }

  /**
   * Twilio signs the URL it called. Behind nginx the app sees http and an
   * internal host, so prefer the forwarded headers, falling back to the
   * configured public URL.
   */
  private rebuildUrl(req: SignedRequest): string {
    const configured = process.env.SMS_WEBHOOK_PUBLIC_URL;
    if (configured) return configured;

    const first = (v: string | string[] | undefined): string =>
      Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

    const proto =
      first(req.headers['x-forwarded-proto']) || req.protocol || 'https';
    const host =
      first(req.headers['x-forwarded-host']) || first(req.headers.host) || '';
    return `${proto}://${host}${req.originalUrl || req.url}`;
  }
}

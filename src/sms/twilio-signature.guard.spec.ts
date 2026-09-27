import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TwilioSignatureGuard } from './twilio-signature.guard';

/**
 * The inbound webhook mutates consent state, so an unauthenticated or
 * forgeable request is a compliance and security problem.
 *
 * Production has shipped the literal string "none" for TWILIO_AUTH_TOKEN. A
 * naive truthiness check accepts that as an HMAC key, which means anyone who
 * guesses the placeholder can sign a valid-looking STOP. These tests pin that
 * shut.
 */
describe('TwilioSignatureGuard', () => {
  const URL = 'https://api.ovrlap.app/sms/inbound';
  const REAL_TOKEN = 'a'.repeat(31) + 'b'; // 32 chars, not a repeated character
  let guard: TwilioSignatureGuard;
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SMS_WEBHOOK_PUBLIC_URL: URL };
    guard = new TwilioSignatureGuard();
    jest.spyOn(guard['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(guard['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const sign = (token: string, body: Record<string, string>) =>
    crypto
      .createHmac('sha1', token)
      .update(
        Buffer.from(
          URL +
            Object.keys(body)
              .sort()
              .map((k) => k + body[k])
              .join(''),
          'utf-8',
        ),
      )
      .digest('base64');

  const ctx = (body: Record<string, string>, signature?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: signature ? { 'x-twilio-signature': signature } : {},
          body,
          protocol: 'https',
          originalUrl: '/sms/inbound',
          url: '/sms/inbound',
        }),
      }),
    }) as unknown as ExecutionContext;

  const STOP = { From: '+15555550147', Body: 'STOP' };

  describe('with a real auth token', () => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = REAL_TOKEN;
    });

    it('accepts a correctly signed request', () => {
      expect(guard.canActivate(ctx(STOP, sign(REAL_TOKEN, STOP)))).toBe(true);
    });

    it('rejects a missing signature', () => {
      expect(() => guard.canActivate(ctx(STOP))).toThrow(ForbiddenException);
    });

    it('rejects a signature made with the wrong key', () => {
      expect(() =>
        guard.canActivate(ctx(STOP, sign('wrong-key-entirely', STOP))),
      ).toThrow(ForbiddenException);
    });

    it('rejects a tampered body', () => {
      const signature = sign(REAL_TOKEN, STOP);
      const tampered = { ...STOP, From: '+15555550999' };
      expect(() => guard.canActivate(ctx(tampered, signature))).toThrow(
        ForbiddenException,
      );
    });
  });

  // The defect this class of test exists for.
  describe.each([
    'none',
    'NONE',
    'changeme',
    'placeholder',
    'todo',
    '00000000',
  ])('with the placeholder token %p', (placeholder) => {
    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = placeholder;
    });

    it('rejects a request forged with that placeholder as the key', () => {
      // An attacker who guesses the placeholder can produce a signature that
      // would verify against it. The guard must refuse before it ever gets
      // that far.
      expect(() =>
        guard.canActivate(ctx(STOP, sign(placeholder, STOP))),
      ).toThrow(ForbiddenException);
    });

    it('rejects unsigned requests too', () => {
      expect(() => guard.canActivate(ctx(STOP))).toThrow(ForbiddenException);
    });
  });

  it('rejects everything when the token is unset', () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    expect(() => guard.canActivate(ctx(STOP))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(STOP, sign('', STOP)))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a token that is too short to be a real secret', () => {
    process.env.TWILIO_AUTH_TOKEN = 'abc123';
    expect(() => guard.canActivate(ctx(STOP, sign('abc123', STOP)))).toThrow(
      ForbiddenException,
    );
  });
});

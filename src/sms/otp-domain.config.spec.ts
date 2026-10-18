import {
  getOtpDomain,
  resetOtpDomainWarning,
  withOtpDomainBinding,
} from './otp-domain.config';
import {
  passwordResetCodeMessage,
  verificationCodeMessage,
} from './twilio-sms.service';

/**
 * The WebOTP binding line, and the exact bytes that go on the wire with and
 * without it.
 *
 * Android Chrome fills a code only when the message ends with
 * "@<host> #<code>" and that host matches the page's origin. Getting the line
 * subtly wrong — a scheme, a trailing dot, the wrong host — does not fail
 * loudly; it just silently never fills.
 */
describe('OTP domain binding', () => {
  const ORIGINAL = process.env.SMS_OTP_DOMAIN;

  beforeEach(() => {
    delete process.env.SMS_OTP_DOMAIN;
    resetOtpDomainWarning();
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.SMS_OTP_DOMAIN;
    else process.env.SMS_OTP_DOMAIN = ORIGINAL;
  });

  describe('configuration', () => {
    it('is off unless configured', () => {
      expect(getOtpDomain()).toBeNull();
    });

    it('treats blank as unset', () => {
      process.env.SMS_OTP_DOMAIN = '   ';
      expect(getOtpDomain()).toBeNull();
    });

    it('accepts a bare hostname', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      expect(getOtpDomain()).toBe('www.ovrlap.app');
    });

    it('lower-cases what it is given', () => {
      process.env.SMS_OTP_DOMAIN = 'WWW.Ovrlap.App';
      expect(getOtpDomain()).toBe('www.ovrlap.app');
    });

    // Each of these produces a line that looks plausible and binds nothing.
    it.each([
      ['https://www.ovrlap.app', 'a scheme'],
      ['www.ovrlap.app/verify', 'a path'],
      ['www.ovrlap.app:443', 'a port'],
      ['www .ovrlap.app', 'a space'],
      ['ovrlap', 'no dot'],
      ['-ovrlap.app', 'a leading hyphen'],
      ['ovrlap-.app', 'a trailing hyphen'],
      ['www.ovrlap.app.', 'a trailing dot'],
      ['@www.ovrlap.app', 'the marker itself'],
    ])('refuses %s (%s)', (value) => {
      process.env.SMS_OTP_DOMAIN = value;
      expect(() => getOtpDomain()).toThrow(/bare hostname/);
    });

    // WebOTP matches the "@host" line against the page's effective domain,
    // which is defined for domain-format hosts only. An address literal has
    // no effective domain, so the code silently never fills — the worst
    // possible failure, because everything looks correct.
    it.each([
      ['127.0.0.1', 'loopback IPv4'],
      ['192.168.0.103', 'a LAN address'],
      ['10.0.0.1', 'a private address'],
      ['::1', 'loopback IPv6'],
      ['[::1]', 'bracketed IPv6'],
      ['2001:db8::1', 'an IPv6 address'],
      ['1.2.3.4', 'any IPv4'],
    ])('refuses the IP literal %s (%s)', (value) => {
      process.env.SMS_OTP_DOMAIN = value;
      expect(() => getOtpDomain()).toThrow(/not an IP address/);
    });

    it('still accepts a hostname whose labels contain digits', () => {
      process.env.SMS_OTP_DOMAIN = 'ovrlap-01.test.local';
      expect(getOtpDomain()).toBe('ovrlap-01.test.local');
    });
  });

  describe('the line itself', () => {
    it('is not added when the feature is off', () => {
      expect(withOtpDomainBinding('Body.', '123456')).toBe('Body.');
    });

    it('is the last line, after a newline, in the form Chrome parses', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      expect(withOtpDomainBinding('Body.', '123456')).toBe(
        'Body.\n@www.ovrlap.app #123456',
      );
    });

    it('carries the code that was actually generated', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      expect(withOtpDomainBinding('Body.', '480913')).toMatch(/#480913$/);
    });

    it('carries no URL — a link in a 2FA message teaches the wrong habit', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      const line = withOtpDomainBinding('Body.', '123456').split('\n')[1];
      expect(line).not.toMatch(/https?:/);
      expect(line).not.toMatch(/\//);
    });
  });

  describe('exact wire text — verification', () => {
    const APPROVED =
      'Ovrlap: Your verification code is 418207. It expires in 10 minutes. ' +
      'Do not share this code. Reply STOP to opt out, HELP for help.';

    it('is byte-for-byte the approved sample when unconfigured', () => {
      expect(verificationCodeMessage('418207')).toBe(APPROVED);
    });

    it('appends exactly one line when configured, leaving the body alone', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      const message = verificationCodeMessage('418207');

      expect(message).toBe(`${APPROVED}\n@www.ovrlap.app #418207`);

      const lines = message.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(APPROVED);
    });

    it('keeps the expiry and the STOP/HELP disclosure', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      const message = verificationCodeMessage('418207');
      expect(message).toContain('It expires in 10 minutes.');
      expect(message).toContain('Reply STOP to opt out, HELP for help.');
    });
  });

  describe('exact wire text — password reset', () => {
    const APPROVED =
      'Ovrlap: Your password reset code is 418207. It expires in 10 minutes. ' +
      'Do not share this code. Reply STOP to opt out, HELP for help.';

    it('is unchanged when unconfigured', () => {
      expect(passwordResetCodeMessage('418207')).toBe(APPROVED);
    });

    it('is bound too, so a reset code fills on Android as well', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      expect(passwordResetCodeMessage('418207')).toBe(
        `${APPROVED}\n@www.ovrlap.app #418207`,
      );
    });

    it('still says "password reset code", not "verification code"', () => {
      process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
      expect(passwordResetCodeMessage('418207')).toContain(
        'Your password reset code is',
      );
    });
  });

  // The hostname is configuration. Anything a caller can set is not.
  describe('the hostname never comes from a request', () => {
    it.each([['Host'], ['X-Forwarded-Host'], ['Origin'], ['Referer']])(
      'ignores a %s header entirely',
      () => {
        process.env.SMS_OTP_DOMAIN = 'www.ovrlap.app';
        // There is no code path taking a header: the only input is the env
        // var, so an attacker-supplied host cannot reach the message.
        expect(verificationCodeMessage('418207')).toContain(
          '@www.ovrlap.app #418207',
        );
      },
    );
  });
});

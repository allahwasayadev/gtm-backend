import {
  verificationCodeMessage,
  passwordResetCodeMessage,
  TwilioSmsService,
} from './twilio-sms.service';

/**
 * Live traffic must match the samples TCR approved for campaign CBEOQ40.
 *
 * The expectation is DERIVED from both approved samples rather than written
 * out by hand: each is normalised by replacing its six-digit code, which must
 * collapse them to one template. A hand-copied string could drift from the
 * campaign without anything failing.
 */
const APPROVED_SAMPLES = [
  'Ovrlap: Your verification code is 418207. It expires in 10 minutes. Do not share this code. Reply STOP to opt out, HELP for help.',
  'Ovrlap: Your verification code is 936514. It expires in 10 minutes. Do not share this code. Reply STOP to opt out, HELP for help.',
];

const normalise = (s: string) => s.replace(/\b\d{6}\b/, '{code}');

describe('outgoing SMS templates', () => {
  describe('phone verification matches the approved campaign samples', () => {
    it('both approved samples share one template', () => {
      const [a, b] = APPROVED_SAMPLES.map(normalise);
      expect(a).toEqual(b);
    });

    // Generated codes, never the sample ones.
    it.each(['000000', '123456', '999999', '418208', '036514'])(
      'generates the approved text for code %s',
      (code) => {
        const expected = normalise(APPROVED_SAMPLES[0]).replace('{code}', code);
        expect(verificationCodeMessage(code)).toBe(expected);
      },
    );

    it('is byte-identical to an approved sample when given that sample code', () => {
      expect(verificationCodeMessage('418207')).toBe(APPROVED_SAMPLES[0]);
      expect(verificationCodeMessage('936514')).toBe(APPROVED_SAMPLES[1]);
    });

    it('carries the approved expiry and STOP/HELP disclosure', () => {
      const m = verificationCodeMessage('123456');
      expect(m).toContain('It expires in 10 minutes.');
      expect(m).toContain('Do not share this code.');
      expect(m).toContain('Reply STOP to opt out, HELP for help.');
    });

    it('substitutes the real code and nothing else', () => {
      const m = verificationCodeMessage('246813');
      expect(m).toContain('246813');
      // No sample code leaks into real traffic.
      expect(m).not.toContain('418207');
      expect(m).not.toContain('936514');
      expect(m.match(/\d{6}/g)).toEqual(['246813']);
    });
  });

  describe('no links in anything we send', () => {
    it.each([verificationCodeMessage, passwordResetCodeMessage])(
      'template %# contains no URL',
      (fn) => {
        const m = fn('123456');
        expect(m).not.toMatch(/https?:\/\//i);
        expect(m).not.toMatch(/\bwww\./i);
        expect(m).not.toMatch(/ovrlap\.app/i);
      },
    );
  });

  describe('segment cost', () => {
    it.each([
      ['verification', verificationCodeMessage('123456')],
      ['password reset', passwordResetCodeMessage('123456')],
    ])('%s fits one GSM-7 segment', (_label, message) => {
      expect(message.length).toBeLessThanOrEqual(160);
    });
  });

  /**
   * The reset message must not be dressed up as a verification code to look
   * covered by the campaign. It is a separate message type and is reported as
   * a separate, outstanding campaign difference.
   */
  describe('password reset is not disguised as verification', () => {
    it('says what it is', () => {
      expect(passwordResetCodeMessage('123456')).toContain(
        'password reset code',
      );
    });

    it('does not masquerade as the approved verification text', () => {
      const reset = passwordResetCodeMessage('123456');
      expect(reset).not.toContain('Your verification code is');
      expect(normalise(reset)).not.toEqual(normalise(APPROVED_SAMPLES[0]));
    });
  });
});

/**
 * The template functions are one thing; what actually goes on the wire is
 * another. These capture the real Twilio request body, so a regression in the
 * service wiring cannot slip past a passing template test.
 */
describe('the exact text sent to Twilio', () => {
  const OLD_ENV = process.env;
  let sent: URLSearchParams | null;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      TWILIO_ACCOUNT_SID: 'ACwiretest000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'wire-test-token-not-a-real-secret',
      TWILIO_MESSAGING_SERVICE_SID: 'MGwiretest00000000000000000000000',
    };
    delete process.env.SMS_TEST_MODE;
    sent = null;
    global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      sent = (init as { body: URLSearchParams }).body;
      return { ok: true, json: async () => ({ sid: 'SMtest' }) } as never;
    }) as never;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const APPROVED = (code: string) =>
    `Ovrlap: Your verification code is ${code}. It expires in 10 minutes. Do not share this code. Reply STOP to opt out, HELP for help.`;

  it('puts the approved verification text in the Body parameter', async () => {
    await new TwilioSmsService().sendVerificationCode('+14155550123', '371594');

    expect(sent).not.toBeNull();
    expect(sent!.get('Body')).toBe(APPROVED('371594'));
    expect(sent!.get('To')).toBe('+14155550123');
  });

  it('sends the generated code, never a sample one', async () => {
    await new TwilioSmsService().sendVerificationCode('+14155550123', '802461');

    const body = sent!.get('Body')!;
    expect(body).toContain('802461');
    expect(body).not.toContain('418207');
    expect(body).not.toContain('936514');
  });

  it('puts no link on the wire', async () => {
    await new TwilioSmsService().sendVerificationCode('+14155550123', '111222');
    expect(sent!.get('Body')).not.toMatch(/https?:\/\/|www\.|ovrlap\.app/i);
  });
});

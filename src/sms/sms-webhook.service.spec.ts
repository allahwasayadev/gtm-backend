import { Test } from '@nestjs/testing';
import { SmsWebhookService } from './sms-webhook.service';
import { TwilioSmsService } from './twilio-sms.service';
import { SmsConsentService } from './sms-consent.service';

/**
 * Regression cover for the A2P 10DLC keyword contract. These behaviours are
 * what Twilio checks, so a silent change here is a compliance failure.
 */
describe('SmsWebhookService', () => {
  let service: SmsWebhookService;
  let consent: jest.Mocked<
    Pick<SmsConsentService, 'recordOptOut' | 'recordResubscribe'>
  >;
  let twilio: jest.Mocked<Pick<TwilioSmsService, 'sendSms'>>;

  const FROM = '+15555550147';

  beforeEach(async () => {
    consent = {
      recordOptOut: jest.fn().mockResolvedValue(undefined),
      recordResubscribe: jest.fn().mockResolvedValue(undefined),
    };
    twilio = { sendSms: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsWebhookService,
        { provide: SmsConsentService, useValue: consent },
        { provide: TwilioSmsService, useValue: twilio },
      ],
    }).compile();

    service = moduleRef.get(SmsWebhookService);
  });

  describe('STOP', () => {
    // The previous implementation required an exact string match, so real
    // replies like "STOP." silently failed to opt the user out.
    it.each([
      'STOP',
      'stop',
      'Stop',
      'STOP.',
      'stop!',
      'stop please',
      'UNSUBSCRIBE',
      'CANCEL',
      'QUIT',
    ])('revokes consent for %p', async (body) => {
      await service.handleInbound(FROM, body);
      expect(consent.recordOptOut).toHaveBeenCalledWith(FROM, 'sms_keyword');
    });

    it('replies with a brand-identified confirmation', async () => {
      await service.handleInbound(FROM, 'STOP');
      const [, message] = twilio.sendSms.mock.calls[0];
      expect(message).toContain('Ovrlap');
      expect(message).toContain('unsubscribed');
      expect(message).toMatch(/START/);
    });

    it('still records the opt-out when the confirmation SMS fails', async () => {
      twilio.sendSms.mockRejectedValueOnce(new Error('21610 blocked'));
      await expect(
        service.handleInbound(FROM, 'STOP'),
      ).resolves.toBeUndefined();
      expect(consent.recordOptOut).toHaveBeenCalled();
    });
  });

  describe('START', () => {
    it.each(['START', 'unstop', 'YES', 'Resume'])(
      'resubscribes for %p',
      async (body) => {
        await service.handleInbound(FROM, body);
        expect(consent.recordResubscribe).toHaveBeenCalledWith(
          FROM,
          'sms_keyword',
        );
      },
    );
  });

  describe('HELP', () => {
    it('replies with brand, support contact and the rates notice', async () => {
      await service.handleInbound(FROM, 'HELP');
      const [, message] = twilio.sendSms.mock.calls[0];
      expect(message).toContain('Ovrlap');
      expect(message).toContain('support@ovrlap.app');
      expect(message).toMatch(/rates may apply/i);
      expect(message).toMatch(/STOP/);
    });

    it('does not change consent state', async () => {
      await service.handleInbound(FROM, 'HELP');
      expect(consent.recordOptOut).not.toHaveBeenCalled();
      expect(consent.recordResubscribe).not.toHaveBeenCalled();
    });
  });

  it('ignores unrelated messages', async () => {
    await service.handleInbound(FROM, 'what is this');
    expect(consent.recordOptOut).not.toHaveBeenCalled();
    expect(consent.recordResubscribe).not.toHaveBeenCalled();
    expect(twilio.sendSms).not.toHaveBeenCalled();
  });

  it('ignores an empty sender', async () => {
    await service.handleInbound('', 'STOP');
    expect(consent.recordOptOut).not.toHaveBeenCalled();
  });
});

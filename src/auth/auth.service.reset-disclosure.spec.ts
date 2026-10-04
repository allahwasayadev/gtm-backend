import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * Password reset must look identical from the outside no matter what is true
 * on the inside. Unknown identifier, no verified phone, opted out via STOP,
 * rate-limited, Twilio failing — all return the same thing.
 *
 * Any observable difference is an account-existence oracle.
 */
describe('AuthService — password reset discloses nothing', () => {
  let service: AuthService;
  let repo: {
    findUserByEmail: jest.Mock;
    findUserByPhoneNumber: jest.Mock;
    updatePasswordReset: jest.Mock;
  };
  let sms: { sendPasswordResetCode: jest.Mock };
  let consent: { assertMaySend: jest.Mock };

  const NEUTRAL =
    'If an account exists with a verified mobile number, a reset code has been sent to it.';

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'known@example.test',
    name: 'Known User',
    phoneNumber: '+14155550123',
    isPhoneVerified: true,
    lastPasswordResetRequestAt: null,
    ...over,
  });

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      updatePasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    sms = { sendPasswordResetCode: jest.fn().mockResolvedValue(undefined) };
    consent = { assertMaySend: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
        { provide: EmailService, useValue: {} },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('accepts an email address as the identifier', async () => {
    repo.findUserByEmail.mockResolvedValue(account());
    await expect(
      service.requestPasswordReset('known@example.test'),
    ).resolves.toEqual({ message: NEUTRAL });
    expect(sms.sendPasswordResetCode).toHaveBeenCalled();
  });

  it('accepts a phone number as the identifier', async () => {
    repo.findUserByPhoneNumber.mockResolvedValue(account());
    await expect(
      service.requestPasswordReset('+1 415 555 0123'),
    ).resolves.toEqual({ message: NEUTRAL });
    expect(repo.findUserByPhoneNumber).toHaveBeenCalled();
    expect(sms.sendPasswordResetCode).toHaveBeenCalled();
  });

  it('never emails a reset code or link', async () => {
    repo.findUserByEmail.mockResolvedValue(account());
    await service.requestPasswordReset('known@example.test');
    const message = sms.sendPasswordResetCode.mock.calls[0][1];
    expect(message).toMatch(/^\d{6}$/); // a code, passed to the SMS sender
  });

  describe('every path returns the same neutral message', () => {
    it('unknown identifier', async () => {
      await expect(
        service.requestPasswordReset('nobody@example.test'),
      ).resolves.toEqual({ message: NEUTRAL });
    });

    it('account with no verified phone — and sends nothing', async () => {
      repo.findUserByEmail.mockResolvedValue(
        account({ isPhoneVerified: false }),
      );
      await expect(
        service.requestPasswordReset('known@example.test'),
      ).resolves.toEqual({ message: NEUTRAL });
      expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    // A number that replied STOP must be blocked, not bypassed.
    it('opted out via STOP — blocked, not bypassed', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      consent.assertMaySend.mockRejectedValue(new Error('opted out'));
      await expect(
        service.requestPasswordReset('known@example.test'),
      ).resolves.toEqual({ message: NEUTRAL });
      expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('inside the resend cooldown — silently, with no 429', async () => {
      repo.findUserByEmail.mockResolvedValue(
        account({ lastPasswordResetRequestAt: new Date(Date.now() - 5000) }),
      );
      await expect(
        service.requestPasswordReset('known@example.test'),
      ).resolves.toEqual({ message: NEUTRAL });
      expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('Twilio delivery failure', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      sms.sendPasswordResetCode.mockRejectedValue(new Error('twilio 30034'));
      await expect(
        service.requestPasswordReset('known@example.test'),
      ).resolves.toEqual({ message: NEUTRAL });
    });
  });

  it('is byte-identical across all five outcomes', async () => {
    const results: string[] = [];

    results.push(
      JSON.stringify(await service.requestPasswordReset('a@example.test')),
    );

    repo.findUserByEmail.mockResolvedValue(account());
    results.push(
      JSON.stringify(await service.requestPasswordReset('b@example.test')),
    );

    repo.findUserByEmail.mockResolvedValue(account({ isPhoneVerified: false }));
    results.push(
      JSON.stringify(await service.requestPasswordReset('c@example.test')),
    );

    repo.findUserByEmail.mockResolvedValue(account());
    consent.assertMaySend.mockRejectedValue(new Error('opted out'));
    results.push(
      JSON.stringify(await service.requestPasswordReset('d@example.test')),
    );

    consent.assertMaySend.mockResolvedValue(undefined);
    sms.sendPasswordResetCode.mockRejectedValue(new Error('twilio down'));
    results.push(
      JSON.stringify(await service.requestPasswordReset('e@example.test')),
    );

    expect(new Set(results).size).toBe(1);
  });
});

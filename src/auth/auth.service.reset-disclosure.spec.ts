import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * A password reset endpoint must look identical whether or not the address is
 * registered. The cooldown previously threw 429 for a KNOWN address while an
 * unknown one returned the neutral message — which disclosed precisely what
 * the neutral message exists to hide.
 */
describe('AuthService — password reset must not disclose account existence', () => {
  let service: AuthService;
  let repo: {
    findUserByEmail: jest.Mock;
    updatePasswordReset: jest.Mock;
  };
  let email: { sendPasswordResetEmail: jest.Mock };

  const NEUTRAL =
    'If an account exists with this email, a password reset link has been sent.';

  const userWithLastRequest = (secondsAgo: number | null) => ({
    id: 'u1',
    email: 'known@example.test',
    name: 'Known User',
    lastPasswordResetRequestAt:
      secondsAgo === null ? null : new Date(Date.now() - secondsAgo * 1000),
  });

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn(),
      updatePasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
        { provide: EmailService, useValue: email },
        { provide: TwilioSmsService, useValue: {} },
        { provide: SmsConsentService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('returns the neutral message for an unknown address', async () => {
    repo.findUserByEmail.mockResolvedValue(null);
    await expect(
      service.requestPasswordReset('nobody@example.test'),
    ).resolves.toEqual({ message: NEUTRAL });
  });

  it('returns the same neutral message for a known address', async () => {
    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(null));
    await expect(
      service.requestPasswordReset('known@example.test'),
    ).resolves.toEqual({ message: NEUTRAL });
  });

  // The regression this suite exists for.
  it('does not throw 429 for a known address inside the cooldown', async () => {
    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(5));
    await expect(
      service.requestPasswordReset('known@example.test'),
    ).resolves.toEqual({ message: NEUTRAL });
  });

  it('suppresses the send while rate-limited rather than revealing it', async () => {
    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(5));
    await service.requestPasswordReset('known@example.test');
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(repo.updatePasswordReset).not.toHaveBeenCalled();
  });

  it('still sends once the cooldown has passed', async () => {
    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(120));
    await service.requestPasswordReset('known@example.test');
    expect(email.sendPasswordResetEmail).toHaveBeenCalled();
  });

  // Telling the caller delivery failed would confirm the address exists.
  it('hides a delivery failure behind the same neutral message', async () => {
    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(null));
    email.sendPasswordResetEmail.mockResolvedValue(false);
    await expect(
      service.requestPasswordReset('known@example.test'),
    ).resolves.toEqual({ message: NEUTRAL });
  });

  it('is indistinguishable across unknown, known, rate-limited and failed-send', async () => {
    const results: unknown[] = [];

    repo.findUserByEmail.mockResolvedValue(null);
    results.push(await service.requestPasswordReset('a@example.test'));

    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(null));
    results.push(await service.requestPasswordReset('b@example.test'));

    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(5));
    results.push(await service.requestPasswordReset('c@example.test'));

    repo.findUserByEmail.mockResolvedValue(userWithLastRequest(null));
    email.sendPasswordResetEmail.mockResolvedValue(false);
    results.push(await service.requestPasswordReset('d@example.test'));

    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

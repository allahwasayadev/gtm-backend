import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';
import { JwtStrategy } from './strategies/jwt.strategy';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

/**
 * Regression: the public phone-verify endpoint was keyed on an email address,
 * and verifyPhoneCode returned a session token for an already-verified account
 * BEFORE checking the submitted code. A known email plus any six digits was
 * therefore enough to obtain that user's session, with no password.
 *
 * Two things had to change: verifyPhoneCode must never mint a token without
 * checking a code, and activation must be authorised by something better than
 * knowing an email address.
 */
describe('AuthService — activation cannot mint a session without a correct code', () => {
  let service: AuthService;
  let repo: Record<string, jest.Mock>;
  let jwt: { sign: jest.Mock; verify: jest.Mock };

  const VERIFIED_USER = {
    id: 'victim-1',
    email: 'victim@example.test',
    name: 'Victim',
    phoneNumber: '+14843231498',
    isPhoneVerified: true,
    // Present on purpose: proves rejection is not merely "no code stored".
    phoneVerificationCode: 'some-stored-hash',
    phoneVerificationCodeExpiresAt: new Date(Date.now() + 600_000),
    phoneVerificationAttempts: 0,
  };

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(VERIFIED_USER),
      findUserById: jest.fn().mockResolvedValue(VERIFIED_USER),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      setPhoneVerified: jest.fn().mockResolvedValue(VERIFIED_USER),
      incrementPhoneVerificationAttempts: jest.fn(),
      updatePhoneVerification: jest.fn().mockResolvedValue(VERIFIED_USER),
    };
    jwt = {
      sign: jest.fn().mockReturnValue('SESSION-TOKEN'),
      // A validly-signed activation token for the victim.
      verify: jest
        .fn()
        .mockReturnValue({ sub: 'victim-1', email: VERIFIED_USER.email, scope: 'activation' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: jwt },
        { provide: EmailService, useValue: {} },
        { provide: TwilioSmsService, useValue: { sendVerificationCode: jest.fn() } },
        { provide: SmsConsentService, useValue: { assertMaySend: jest.fn(), recordConsent: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('there is no email-keyed activation method left to attack', () => {
    expect(
      (service as unknown as Record<string, unknown>).verifySignupPhone,
    ).toBeUndefined();
  });

  // The reported attack, now expressed against the replacement endpoint.
  it('refuses an already-verified account with an incorrect code', async () => {
    await expect(
      service.verifyActivation('ACTIVATION-TOKEN', '000000'),
    ).rejects.toThrow();
  });

  it('returns no token for an already-verified account, whatever the code', async () => {
    for (const code of ['000000', '123456', '999999', '111111']) {
      let token: unknown = 'NOT-SET';
      try {
        const res = await service.verifyActivation('ACTIVATION-TOKEN', code);
        token = (res as { token?: string }).token;
      } catch {
        token = undefined;
      }
      expect(token).toBeUndefined();
    }
  });

  it('never signs a token on that path', async () => {
    await service
      .verifyActivation('ACTIVATION-TOKEN', '000000')
      .catch(() => undefined);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('does not mark anything verified as a side effect', async () => {
    await service
      .verifyActivation('ACTIVATION-TOKEN', '000000')
      .catch(() => undefined);
    expect(repo.setPhoneVerified).not.toHaveBeenCalled();
  });

  // Root cause: the authenticated path must not short-circuit either.
  it('verifyPhoneCode itself refuses an already-verified account', async () => {
    await expect(service.verifyPhoneCode('victim-1', '000000')).rejects.toThrow();
  });

  it('rejects a token that is not scoped to activation', async () => {
    jwt.verify.mockReturnValue({ sub: 'victim-1', email: VERIFIED_USER.email });
    await expect(
      service.verifyActivation('A-NORMAL-SESSION-TOKEN', '000000'),
    ).rejects.toThrow();
  });

  it('rejects a forged or expired activation token', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(
      service.verifyActivation('FORGED', '000000'),
    ).rejects.toThrow();
  });
});

/**
 * The activation token is signed with the same key as a session token, so the
 * JWT strategy has to reject it explicitly or it would authenticate every
 * guarded route in the application.
 */
describe('JwtStrategy — an activation token is not a session', () => {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
  };
  const strategy = new JwtStrategy(prisma as never);

  it('refuses a token carrying scope: activation', async () => {
    await expect(
      strategy.validate({
        sub: 'u1',
        email: 'a@example.test',
        scope: 'activation',
      }),
    ).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a normal session token', async () => {
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@example.test' }),
    ).resolves.toEqual({ id: 'u1' });
  });
});

import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';
import {
  JwtAuthGuard,
  assertPhoneVerified,
} from './guards/jwt-auth.guard';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

/**
 * Existing users must be migrated in place: same account, same data, no
 * re-signup. Two ways in — a fresh sign-in, and a session that is already
 * active and so never passes through login again.
 *
 * Nothing here may text anyone. The 18 accounts with no number and the 9
 * seeded demo personas must not be messaged just for showing up.
 */
describe('AuthService — existing-user migration', () => {
  let service: AuthService;
  let repo: Record<string, jest.Mock>;
  let sms: Record<string, jest.Mock>;

  const LEGACY_NO_PHONE = {
    id: 'legacy-1',
    email: 'someone@example.test',
    name: 'Legacy User',
    passwordHash: 'x',
    phoneNumber: null,
    isPhoneVerified: false,
    pendingSignupSince: null, // never a pending signup: a real account
  };

  const LEGACY_WITH_PHONE = {
    ...LEGACY_NO_PHONE,
    id: 'legacy-2',
    phoneNumber: '+14155550123',
  };

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(LEGACY_NO_PHONE),
      findUserById: jest.fn().mockResolvedValue(LEGACY_NO_PHONE),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      updatePhoneVerification: jest.fn().mockResolvedValue(LEGACY_NO_PHONE),
      setPhoneVerified: jest.fn().mockResolvedValue(LEGACY_NO_PHONE),
      deleteUser: jest.fn(),
    };
    sms = { sendVerificationCode: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('TOKEN'),
            verify: jest.fn().mockReturnValue({ sub: 'legacy-1', scope: 'activation' }),
          },
        },
        { provide: EmailService, useValue: {} },
        { provide: TwilioSmsService, useValue: sms },
        {
          provide: SmsConsentService,
          useValue: { assertMaySend: jest.fn(), recordConsent: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('fresh sign-in', () => {
    const LOGIN = { email: 'someone@example.test', password: 'pw' } as never;

    it('refuses a session and returns an activation token, not an error', async () => {
      await expect(service.login(LOGIN)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: expect.objectContaining({
          code: 'PHONE_VERIFICATION_REQUIRED',
          needsPhoneNumber: true,
          activationToken: 'TOKEN',
        }),
      });
    });

    it('sends NO sms on sign-in', async () => {
      await service.login(LOGIN).catch(() => undefined);
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('flags a saved number instead of asking for one', async () => {
      repo.findUserByEmail.mockResolvedValue(LEGACY_WITH_PHONE);
      await expect(service.login(LOGIN)).rejects.toMatchObject({
        response: expect.objectContaining({ needsPhoneNumber: false }),
      });
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('does not delete or replace the account', async () => {
      await service.login(LOGIN).catch(() => undefined);
      expect(repo.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('already-active session', () => {
    it('trades the session for an activation token without sending anything', async () => {
      const res = await service.activationFromSession('legacy-1');
      expect(res.activationToken).toBe('TOKEN');
      expect(res.needsPhoneNumber).toBe(true);
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('masks a saved number rather than echoing it', async () => {
      repo.findUserById.mockResolvedValue(LEGACY_WITH_PHONE);
      const res = await service.activationFromSession('legacy-2');
      expect(res.needsPhoneNumber).toBe(false);
      expect(res.phoneHint).not.toContain('4155550');
      expect(res.phoneHint).toContain('0123');
    });

    it('refuses once the account is already verified', async () => {
      repo.findUserById.mockResolvedValue({
        ...LEGACY_WITH_PHONE,
        isPhoneVerified: true,
      });
      await expect(service.activationFromSession('legacy-2')).rejects.toThrow();
    });
  });

  describe('the guard that catches active sessions', () => {
    /**
     * matching, connections, account-lists and invites use this guard but do
     * NOT import JwtModule. Any constructor dependency would therefore fail at
     * runtime in exactly those modules — and not in any unit test, which is
     * why this is asserted explicitly.
     */
    it('takes no constructor dependencies', () => {
      expect(JwtAuthGuard.length).toBe(0);
      expect(() => new JwtAuthGuard()).not.toThrow();
    });

    it('lets a verified session through', () => {
      expect(
        assertPhoneVerified({
          id: 'u1',
          email: 'a@b.test',
          isPhoneVerified: true,
        }),
      ).toBe(true);
    });

    it('raises 403 on an unverified session rather than 401-ing them out', () => {
      expect(() =>
        assertPhoneVerified({
          id: 'u1',
          email: 'a@b.test',
          isPhoneVerified: false,
          phoneNumber: null,
        }),
      ).toThrow(
        expect.objectContaining({ status: HttpStatus.FORBIDDEN }) as never,
      );
    });

    it('tells the client whether a number must be collected', () => {
      try {
        assertPhoneVerified({
          id: 'u1',
          email: 'a@b.test',
          isPhoneVerified: false,
          phoneNumber: '+14155550123',
        });
      } catch (e) {
        const body = (e as { response: Record<string, unknown> }).response;
        expect(body.code).toBe('PHONE_VERIFICATION_REQUIRED');
        expect(body.needsPhoneNumber).toBe(false);
        // Masked, not echoed.
        expect(body.phoneHint).not.toContain('4155550');
      }
    });
  });

  it('a code is only sent when explicitly requested', async () => {
    repo.findUserById.mockResolvedValue(LEGACY_WITH_PHONE);
    expect(sms.sendVerificationCode).not.toHaveBeenCalled();

    await service.resendActivationCode('ACTIVATION-TOKEN');
    expect(sms.sendVerificationCode).toHaveBeenCalledTimes(1);
  });
});

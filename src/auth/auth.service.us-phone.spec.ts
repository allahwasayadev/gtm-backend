import { Test } from '@nestjs/testing';

// bcrypt's exports are non-configurable, so spyOn cannot wrap them.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));
import { BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';
import { SmsConsentSource } from '../sms/sms-consent.constants';

/**
 * US phone entry is the default: the signup, activation and profile screens
 * show a fixed +1 and collect ten digits, so the API has to read those ten
 * digits as the same number as +1XXXXXXXXXX.
 *
 * What must NOT change: one account per number, consent recorded before
 * anything is sent, and the non-US numbers already on existing accounts.
 */
describe('AuthService — US phone entry defaults to +1', () => {
  let service: AuthService;
  let repo: Record<string, jest.Mock>;
  let sms: Record<string, jest.Mock>;
  let consent: Record<string, jest.Mock>;

  const signupDto = (phoneNumber: string) =>
    ({
      name: 'Test User',
      email: 'new@example.test',
      password: 'a-long-enough-password',
      roles: ['OEM'],
      phoneNumber,
      smsConsent: true,
    }) as never;

  const CREATED = {
    id: 'u1',
    email: 'new@example.test',
    name: 'Test User',
    phoneNumber: '+12015550123',
    isPhoneVerified: false,
  };

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      deleteUser: jest.fn().mockResolvedValue(undefined),
      findUserById: jest.fn().mockResolvedValue(CREATED),
      createUser: jest.fn().mockResolvedValue(CREATED),
      updatePhoneVerification: jest.fn().mockResolvedValue(CREATED),
      updatePasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    sms = {
      sendVerificationCode: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetCode: jest.fn().mockResolvedValue(undefined),
    };
    consent = {
      recordConsent: jest.fn().mockResolvedValue(undefined),
      recordConsentIfMissing: jest.fn().mockResolvedValue(undefined),
      assertMaySend: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        {
          provide: JwtService,
          useValue: {
            sign: () => 'jwt',
            verify: () => ({ sub: 'u1', scope: 'activation' }),
          },
        },
        { provide: EmailService, useValue: {} },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('signup', () => {
    // The signup screen submits +1XXXXXXXXXX. These are the other spellings a
    // paste or an older client can still produce.
    it.each([
      ['+12015550123'],
      ['2015550123'],
      ['(201) 555-0123'],
      ['201-555-0123'],
      ['1 201 555 0123'],
      ['+1 (201) 555-0123'],
    ])('stores %s as canonical +12015550123', async (typed) => {
      await service.signup(signupDto(typed));
      expect(repo.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: '+12015550123' }),
      );
    });

    it('texts the canonical number, not what was typed', async () => {
      await service.signup(signupDto('(201) 555-0123'));
      expect(sms.sendVerificationCode).toHaveBeenCalledWith(
        '+12015550123',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('records consent against the canonical number', async () => {
      await service.signup(signupDto('2015550123'));
      expect(consent.recordConsent).toHaveBeenCalledWith(
        'u1',
        '+12015550123',
        expect.objectContaining({ source: SmsConsentSource.SignupForm }),
      );
    });

    // Deduplication is the reason canonicalisation happens before the lookup.
    it('finds the existing holder when the number is typed differently', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue({
        id: 'other',
        email: 'held@example.test',
        pendingSignupSince: null,
      });

      await expect(service.signup(signupDto('(201) 555-0123'))).rejects.toThrow(
        ConflictException,
      );
      expect(repo.findUserByPhoneNumber).toHaveBeenCalledWith('+12015550123');
      expect(repo.createUser).not.toHaveBeenCalled();
    });

    it('still accepts a non-US number with its country code', async () => {
      await service.signup(signupDto('+44 20 7946 0958'));
      expect(repo.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: '+442079460958' }),
      );
    });

    it.each([
      ['201555012', 'nine digits'],
      ['20155501234', 'eleven digits with no country code'],
      ['not a number', 'letters'],
      ['+1', 'a country code alone'],
    ])('rejects %s (%s) without creating an account', async (typed) => {
      await expect(service.signup(signupDto(typed))).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.createUser).not.toHaveBeenCalled();
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('activation — a number added or changed later', () => {
    beforeEach(() => {
      repo.findUserById.mockResolvedValue({
        ...CREATED,
        phoneNumber: null,
        pendingSignupSince: new Date(),
      });
    });

    it('canonicalises ten digits from the activation screen', async () => {
      await service.setActivationPhone('activation-token', '(201) 555-0123');
      expect(repo.updatePhoneVerification).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ phoneNumber: '+12015550123' }),
      );
    });

    it('refuses an unreadable number', async () => {
      await expect(
        service.setActivationPhone('activation-token', '20155'),
      ).rejects.toThrow(BadRequestException);
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('password reset by phone', () => {
    const NEUTRAL =
      'If an account exists with a verified mobile number, a reset code has been sent to it.';

    const verifiedAccount = {
      id: 'u1',
      email: 'known@example.test',
      phoneNumber: '+12015550123',
      isPhoneVerified: true,
      lastPasswordResetRequestAt: null,
    };

    it.each([
      ['2015550123'],
      ['(201) 555-0123'],
      ['+12015550123'],
      ['1 201 555 0123'],
    ])('resolves the account from %s', async (identifier) => {
      repo.findUserByPhoneNumber.mockResolvedValue(verifiedAccount);

      await expect(service.requestPasswordReset(identifier)).resolves.toEqual({
        message: NEUTRAL,
      });
      expect(repo.findUserByPhoneNumber).toHaveBeenCalledWith('+12015550123');
      expect(sms.sendPasswordResetCode).toHaveBeenCalled();
    });

    // A format-specific 400 would say which identifiers the system even
    // considers, which is an account-existence oracle.
    it.each([['201555'], ['not a number'], ['+1']])(
      'answers the neutral message for unreadable identifier %s',
      async (identifier) => {
        await expect(service.requestPasswordReset(identifier)).resolves.toEqual(
          {
            message: NEUTRAL,
          },
        );
        expect(repo.findUserByPhoneNumber).not.toHaveBeenCalled();
        expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
      },
    );

    it('still resolves an email identifier', async () => {
      repo.findUserByEmail.mockResolvedValue(verifiedAccount);
      await service.requestPasswordReset('Known@Example.test');
      expect(repo.findUserByEmail).toHaveBeenCalledWith('known@example.test');
    });

    // The consent and opt-out gate is unchanged by any of this.
    it('sends nothing when consent or opt-out blocks the number', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue(verifiedAccount);
      consent.assertMaySend.mockRejectedValue(new Error('opted out'));

      await expect(service.requestPasswordReset('2015550123')).resolves.toEqual(
        {
          message: NEUTRAL,
        },
      );
      expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('sends nothing to an unverified number', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue({
        ...verifiedAccount,
        isPhoneVerified: false,
      });

      await expect(service.requestPasswordReset('2015550123')).resolves.toEqual(
        {
          message: NEUTRAL,
        },
      );
      expect(sms.sendPasswordResetCode).not.toHaveBeenCalled();
    });

    it('resets with a code when the identifier is ten digits', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue(verifiedAccount);
      await service.requestPasswordReset('2015550123');

      const [, resetFields] = repo.updatePasswordReset.mock.calls[0] as [
        string,
        { passwordResetToken: string },
      ];
      const [, code] = sms.sendPasswordResetCode.mock.calls[0] as [
        string,
        string,
      ];
      const stored = resetFields.passwordResetToken;

      repo.findUserByPhoneNumber.mockResolvedValue({
        ...verifiedAccount,
        passwordResetToken: stored,
        passwordResetTokenExpiresAt: new Date(Date.now() + 60_000),
        passwordResetAttempts: 0,
      });
      repo.updatePassword = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.resetPassword('(201) 555-0123', code, 'a-new-long-password'),
      ).resolves.toEqual({
        message: 'Your password has been reset successfully.',
      });
    });
  });
});

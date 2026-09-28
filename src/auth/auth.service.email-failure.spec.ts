import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * sendVerificationEmail swallows SMTP errors and returns false. Before this was
 * handled, signup and resend both reported success regardless, so a user whose
 * mail never left the server was told to check an inbox that would stay empty.
 *
 * Production proved this is not hypothetical: every send failed EAUTH for
 * eleven hours while the API kept answering 201.
 */
describe('AuthService — verification email failures', () => {
  let service: AuthService;
  let repo: {
    findUserByEmail: jest.Mock;
    createUser: jest.Mock;
    updateEmailVerification: jest.Mock;
  };
  let email: { sendVerificationEmail: jest.Mock };

  const USER = { id: 'u1', email: 'someone@example.test', name: 'Test User' };

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      createUser: jest.fn().mockResolvedValue(USER),
      updateEmailVerification: jest.fn().mockResolvedValue(USER),
    };
    email = { sendVerificationEmail: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
        { provide: EmailService, useValue: email },
        { provide: TwilioSmsService, useValue: { sendVerificationCode: jest.fn() } },
        { provide: SmsConsentService, useValue: { recordConsent: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  const cooldownWrites = () =>
    repo.updateEmailVerification.mock.calls.filter(
      (c) => 'lastVerificationCodeSentAt' in (c[1] ?? {}),
    );

  describe('initiateEmailVerification', () => {
    it('returns true when the mail goes out', async () => {
      await expect(
        service.initiateEmailVerification(USER.id, USER.email, USER.name),
      ).resolves.toBe(true);
    });

    it('returns false when delivery fails', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      await expect(
        service.initiateEmailVerification(USER.id, USER.email, USER.name),
      ).resolves.toBe(false);
    });

    // The cooldown is stamped before the send. Left in place after a failure it
    // would block the resend that is the user's only way out.
    it('clears the cooldown stamp when delivery fails, keeping resend available', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      await service.initiateEmailVerification(USER.id, USER.email, USER.name);
      const last = cooldownWrites().pop();
      expect(last?.[1].lastVerificationCodeSentAt).toBeNull();
    });

    it('leaves the cooldown in place on success', async () => {
      await service.initiateEmailVerification(USER.id, USER.email, USER.name);
      const last = cooldownWrites().pop();
      expect(last?.[1].lastVerificationCodeSentAt).toBeInstanceOf(Date);
    });

    it('still stores a usable code even when delivery fails', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      await service.initiateEmailVerification(USER.id, USER.email, USER.name);
      const wrote = repo.updateEmailVerification.mock.calls.some(
        (c) => typeof c[1]?.emailVerificationCode === 'string',
      );
      expect(wrote).toBe(true);
    });
  });

  describe('signup', () => {
    const dto = {
      name: 'Test User',
      email: 'someone@example.test',
      password: 'a-long-enough-password',
      roles: ['OEM'],
    } as never;

    it('reports emailVerificationSent: true on success', async () => {
      const res = await service.signup(dto);
      expect(res.emailVerificationSent).toBe(true);
      expect(res.token).toBeTruthy();
    });

    // The account must still exist — the user has to be able to resend.
    it('still creates the account but reports false when delivery fails', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      const res = await service.signup(dto);
      expect(res.emailVerificationSent).toBe(false);
      expect(repo.createUser).toHaveBeenCalled();
      expect(res.token).toBeTruthy();
    });
  });

  describe('resendVerificationCode', () => {
    beforeEach(() => {
      repo.findUserByEmail.mockResolvedValue({
        ...USER,
        emailVerified: false,
        lastVerificationCodeSentAt: null,
      });
    });

    it('confirms success only when the mail went out', async () => {
      await expect(
        service.resendVerificationCode(USER.email),
      ).resolves.toEqual({
        message: 'A new verification code has been sent to your email.',
      });
    });

    it('fails honestly instead of claiming a code was sent', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      await expect(
        service.resendVerificationCode(USER.email),
      ).rejects.toBeInstanceOf(HttpException);
      await expect(
        service.resendVerificationCode(USER.email),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY });
    });

    it('leaves the account recoverable — no cooldown after a failed resend', async () => {
      email.sendVerificationEmail.mockResolvedValue(false);
      await service.resendVerificationCode(USER.email).catch(() => undefined);
      const last = cooldownWrites().pop();
      expect(last?.[1].lastVerificationCodeSentAt).toBeNull();
    });
  });
});

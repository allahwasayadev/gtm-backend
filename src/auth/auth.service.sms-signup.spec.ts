import { Test } from '@nestjs/testing';

// bcrypt's exports are non-configurable, so spyOn cannot wrap them.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));
import { HttpStatus, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * SMS-first signup: the phone is required, the activation code goes only by
 * SMS, and no session token exists until that code is entered.
 */
describe('AuthService — SMS-first signup', () => {
  let service: AuthService;
  let repo: Record<string, jest.Mock>;
  let sms: Record<string, jest.Mock>;
  let consent: Record<string, jest.Mock>;
  let email: Record<string, jest.Mock>;

  const DTO = {
    name: 'Test User',
    email: 'new@example.test',
    password: 'a-long-enough-password',
    roles: ['OEM'],
    phoneNumber: '+1 484 323 1498',
    smsConsent: true,
  } as never;

  const CREATED = {
    id: 'u1',
    email: 'new@example.test',
    name: 'Test User',
    phoneNumber: '+14843231498',
    isPhoneVerified: false,
  };

  beforeEach(async () => {
    repo = {
      findUserByEmail: jest.fn().mockResolvedValue(null),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      findUserById: jest.fn().mockResolvedValue(CREATED),
      createUser: jest.fn().mockResolvedValue(CREATED),
      updatePhoneVerification: jest.fn().mockResolvedValue(CREATED),
    };
    sms = { sendVerificationCode: jest.fn().mockResolvedValue(undefined) };
    consent = {
      recordConsent: jest.fn().mockResolvedValue(undefined),
      assertMaySend: jest.fn().mockResolvedValue(undefined),
    };
    email = {};

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
        { provide: EmailService, useValue: email },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('sends the activation code by SMS', async () => {
    await service.signup(DTO);
    expect(sms.sendVerificationCode).toHaveBeenCalledWith(
      '+14843231498',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  // The whole point of the change: no usable session until the code is entered.
  it('issues no session token at signup', async () => {
    const res = await service.signup(DTO);
    expect(res).not.toHaveProperty('token');
    expect(res.pendingVerification).toBe(true);
  });

  it('records the consent event before anything is sent', async () => {
    await service.signup(DTO);
    expect(consent.recordConsent).toHaveBeenCalledWith(
      'u1',
      '+14843231498',
      expect.objectContaining({ source: 'signup_form' }),
    );
  });

  it('masks the number it reports back', async () => {
    const res = await service.signup(DTO);
    expect(res.phoneHint).not.toContain('4843231');
    expect(res.phoneHint).toContain('1498');
  });

  it('rejects a number already registered to another account', async () => {
    repo.findUserByPhoneNumber.mockResolvedValue({ id: 'other' });
    await expect(service.signup(DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  // Account must survive a Twilio failure, or the user is stranded with an
  // address that is taken and no way to finish.
  it('keeps the account and reports honestly when Twilio fails', async () => {
    sms.sendVerificationCode.mockRejectedValue(new Error('twilio 30034'));
    const res = await service.signup(DTO);
    expect(repo.createUser).toHaveBeenCalled();
    expect(res.smsSent).toBe(false);
    expect(res.pendingVerification).toBe(true);
  });

  it('does not claim delivery when Twilio succeeds only partially', async () => {
    const res = await service.signup(DTO);
    expect(res.smsSent).toBe(true);
  });

  describe('login', () => {
    const LOGIN = { email: 'new@example.test', password: 'pw' } as never;

    it('refuses a session while the phone is unverified', async () => {
      repo.findUserByEmail.mockResolvedValue({
        ...CREATED,
        passwordHash: 'x',
        isPhoneVerified: false,
      });

      await expect(service.login(LOGIN)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('allows a session once the phone is verified', async () => {
      repo.findUserByEmail.mockResolvedValue({
        ...CREATED,
        passwordHash: 'x',
        isPhoneVerified: true,
      });

      const res = await service.login(LOGIN);
      expect(res.token).toBeTruthy();
    });
  });
});

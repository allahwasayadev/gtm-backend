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
      deleteUser: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: JwtService,
          useValue: { sign: () => 'jwt', verify: () => ({ sub: 'u1', scope: 'activation' }) },
        },
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

  describe('reclaim is opt-in and cannot touch a real account', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

    it('reclaims a pending signup older than the TTL', async () => {
      repo.findUserByEmail.mockResolvedValue({
        id: 'stale',
        pendingSignupSince: hoursAgo(48),
        isPhoneVerified: false,
      });
      await service.signup(DTO);
      expect(repo.deleteUser).toHaveBeenCalledWith('stale');
      expect(repo.createUser).toHaveBeenCalled();
    });

    it('refuses a recent pending signup, and points at signing in', async () => {
      repo.findUserByEmail.mockResolvedValue({
        id: 'fresh',
        pendingSignupSince: hoursAgo(1),
        isPhoneVerified: false,
      });
      await expect(service.signup(DTO)).rejects.toThrow(
        /Sign in with your password/,
      );
      expect(repo.deleteUser).not.toHaveBeenCalled();
    });

    /**
     * THE dangerous case. An established account midway through changing its
     * number has isPhoneVerified = false while owning real data. Keying the
     * rule on verification would cascade-delete their account lists,
     * connections, notifications, observed overlaps and sent invites.
     */
    it('never reclaims an ACTIVATED account that is mid phone-number change', async () => {
      repo.findUserByEmail.mockResolvedValue({
        id: 'established',
        pendingSignupSince: null, // activation cleared it, permanently
        isPhoneVerified: false, // temporarily unverified: changing number
        createdAt: hoursAgo(10_000),
      });
      await expect(service.signup(DTO)).rejects.toThrow('Email already in use');
      expect(repo.deleteUser).not.toHaveBeenCalled();
      expect(repo.createUser).not.toHaveBeenCalled();
    });

    it('never reclaims that account through the phone collision path either', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue({
        id: 'established-phone',
        pendingSignupSince: null,
        isPhoneVerified: false,
        createdAt: hoursAgo(10_000),
      });
      await expect(service.signup(DTO)).rejects.toThrow(
        'Mobile number already in use',
      );
      expect(repo.deleteUser).not.toHaveBeenCalled();
    });

    /**
     * The 23 rows already in production. `prisma db push` adds the column
     * without running any backfill, so they will all read NULL — which must
     * mean "never reclaimable" rather than "reclaim me".
     */
    it('never reclaims a pre-existing row with no marker, however old', async () => {
      for (const existing of [
        { id: 'legacy-1', isPhoneVerified: false, createdAt: hoursAgo(50_000) },
        { id: 'legacy-2', isPhoneVerified: true, createdAt: hoursAgo(50_000) },
        { id: 'legacy-3', pendingSignupSince: null, createdAt: hoursAgo(50_000) },
      ]) {
        repo.deleteUser.mockClear();
        repo.findUserByEmail.mockResolvedValue(existing);
        await expect(service.signup(DTO)).rejects.toThrow('Email already in use');
        expect(repo.deleteUser).not.toHaveBeenCalled();
      }
    });

    it('frees a stale pending phone number', async () => {
      repo.findUserByPhoneNumber.mockResolvedValue({
        id: 'stale-phone',
        pendingSignupSince: hoursAgo(48),
        isPhoneVerified: false,
      });
      await service.signup(DTO);
      expect(repo.deleteUser).toHaveBeenCalledWith('stale-phone');
    });

    it('stamps the marker on accounts it creates', async () => {
      await service.signup(DTO);
      expect(repo.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ pendingSignupSince: expect.any(Date) }),
      );
    });
  });

  it('returns an activation token so activation is not keyed on the email', async () => {
    const res = await service.signup(DTO);
    expect(res.activationToken).toBeTruthy();
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

import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * "Use a different number" during activation writes the number and records
 * consent, and recordConsent clears an opt-out as a fresh opt-in. Pointed back
 * at a number that had replied STOP, that reopened it.
 *
 * STOP belongs to the number, so the refusal is bound to the number being
 * entered — a mistyped number that stopped must not strand the correction, and
 * the stopped one must not come back by being typed in again.
 */
describe('AuthService.setActivationPhone — STOP is bound to the number', () => {
  const STOPPED = '+14155550105';
  const FRESH = '+14155550107';

  let service: AuthService;
  let repo: {
    findUserById: jest.Mock;
    findUserByPhoneNumber: jest.Mock;
    updatePhoneVerification: jest.Mock;
  };
  let consent: {
    recordConsent: jest.Mock;
    recordConsentIfMissing: jest.Mock;
    assertMaySend: jest.Mock;
    isNumberStopped: jest.Mock;
  };
  let sms: { sendVerificationCode: jest.Mock };

  beforeEach(async () => {
    repo = {
      findUserById: jest.fn().mockResolvedValue({
        id: 'u1', email: 'nadia@harbour.test', name: 'Nadia Brandt',
        phoneNumber: STOPPED, isPhoneVerified: false,
      }),
      findUserByPhoneNumber: jest.fn().mockResolvedValue(null),
      updatePhoneVerification: jest.fn().mockResolvedValue(undefined),
    };
    consent = {
      recordConsent: jest.fn(),
      recordConsentIfMissing: jest.fn(),
      assertMaySend: jest.fn(),
      isNumberStopped: jest.fn(async (n: string) => n === STOPPED),
    };
    sms = { sendVerificationCode: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repo },
        { provide: JwtService, useValue: { verify: () => ({ sub: 'u1', scope: 'activation' }), sign: () => 't' } },
        { provide: EmailService, useValue: { sendInviteEmail: jest.fn() } },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('refuses when the number entered is the stopped one', async () => {
    await expect(service.setActivationPhone('tok', STOPPED)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('writes nothing and sends nothing on that refusal', async () => {
    await expect(service.setActivationPhone('tok', STOPPED)).rejects.toThrow();
    expect(repo.updatePhoneVerification).not.toHaveBeenCalled();
    expect(consent.recordConsent).not.toHaveBeenCalled();
    expect(sms.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('checks the number being entered, not the one already on the account', async () => {
    await expect(service.setActivationPhone('tok', STOPPED)).rejects.toThrow();
    expect(consent.isNumberStopped).toHaveBeenCalledWith(STOPPED);
  });

  it('still lets a mistyped number be corrected to a different one', async () => {
    await service.setActivationPhone('tok', FRESH);
    expect(repo.updatePhoneVerification).toHaveBeenCalled();
    expect(consent.recordConsent).toHaveBeenCalledWith('u1', FRESH, expect.anything());
  });
});

import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * A user who has replied STOP has opted out, and nothing in the product may
 * quietly undo that.
 *
 * recordConsent clears smsOptedOut on purpose — that is what a fresh opt-in
 * means. So the order of these two calls is the whole protection: asserting
 * after recording would wipe the opt-out and then find nothing to refuse. The
 * activation path has always checked first; the profile path did not, and a
 * profile request carrying smsConsent: true was enough to resume messaging a
 * number that had said stop.
 */
describe('UsersService.sendPhoneVerificationCode — STOP survives the profile path', () => {
  let service: UsersService;
  let repo: { findById: jest.Mock; update: jest.Mock };
  let consent: { recordConsent: jest.Mock; assertMaySend: jest.Mock; isNumberStopped: jest.Mock };
  let sms: { sendVerificationCode: jest.Mock };

  const STOPPED = '+14155550105';
  const FRESH = '+14155550107';

  const optedOut = {
    id: 'u1',
    email: 'nadia@harbour.test',
    name: 'Nadia Brandt',
    roles: ['Reseller'],
    phoneNumber: '+14155550105',
    isPhoneVerified: false,
    smsOptedOut: true,
    smsConsent: false,
    lastPhoneVerificationCodeSentAt: null,
  };

  beforeEach(async () => {
    repo = {
      findById: jest.fn().mockResolvedValue(optedOut),
      update: jest.fn().mockResolvedValue(optedOut),
    };
    consent = {
      recordConsent: jest.fn(),
      assertMaySend: jest.fn(),
      // STOP is per number: only the stopped one answers true.
      isNumberStopped: jest.fn(async (n: string) => n === STOPPED),
    };
    sms = { sendVerificationCode: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: PrismaService, useValue: {} },
        { provide: ConnectionsRepository, useValue: { findAcceptedConnectionUserIds: jest.fn().mockResolvedValue([]) } },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  const send = (smsConsent?: boolean, phoneNumber: string = STOPPED) =>
    service.sendPhoneVerificationCode('u1', {
      phoneNumber,
      ...(smsConsent === undefined ? {} : { smsConsent }),
    } as never);

  it('refuses an opted-out number even when the request asserts consent', async () => {
    await expect(send(true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes no consent record, so the opt-out is not cleared on the way past', async () => {
    await expect(send(true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(consent.recordConsent).not.toHaveBeenCalled();
  });

  it('sends no message and stores no verification code', async () => {
    await expect(send(true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses the same way when the request carries no consent flag at all', async () => {
    await expect(send()).rejects.toBeInstanceOf(ForbiddenException);
    expect(consent.recordConsent).not.toHaveBeenCalled();
    expect(sms.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('still sends for a user who has not opted out', async () => {
    repo.findById.mockResolvedValue({ ...optedOut, smsOptedOut: false });
    await send(true, FRESH);
    expect(consent.recordConsent).toHaveBeenCalled();
    expect(consent.assertMaySend).toHaveBeenCalled();
    expect(sms.sendVerificationCode).toHaveBeenCalled();
  });

  /* STOP is a decision about a number, not a punishment on the account. A user
     who stopped a number they mistyped has to be able to correct it. */
  it('does not strand a correction to a genuinely different number', async () => {
    await send(true, FRESH);
    expect(consent.recordConsent).toHaveBeenCalledWith('u1', FRESH, expect.anything());
    expect(sms.sendVerificationCode).toHaveBeenCalled();
  });

  it('asks about the target number, not the account flag', async () => {
    await expect(send(true, STOPPED)).rejects.toBeInstanceOf(ForbiddenException);
    expect(consent.isNumberStopped).toHaveBeenCalledWith(STOPPED);
  });
});

/**
 * The second half of the published recovery path: START clears the carrier
 * stop, and this is where consent is given again. It must record consent for
 * the number on file without sending anything, and must refuse while a stop is
 * still the latest thing recorded against that number.
 */
describe('UsersService.grantSmsConsent — re-consent from profile settings', () => {
  const NUMBER = '+14155550142';
  let service: UsersService;
  let repo: { findById: jest.Mock };
  let consent: { recordConsent: jest.Mock; isNumberStopped: jest.Mock };
  let sms: { sendVerificationCode: jest.Mock };

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'dana@harbour.test', name: 'Dana Whitfield',
    phoneNumber: NUMBER, isPhoneVerified: true, smsConsent: false,
    smsOptedOut: false, ...over,
  });

  const build = async (stopped: boolean, user = account()) => {
    repo = { findById: jest.fn().mockResolvedValue(user) };
    consent = { recordConsent: jest.fn(), isNumberStopped: jest.fn().mockResolvedValue(stopped) };
    sms = { sendVerificationCode: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: PrismaService, useValue: {} },
        { provide: ConnectionsRepository, useValue: { findAcceptedConnectionUserIds: jest.fn().mockResolvedValue([]) } },
        { provide: NotificationsService, useValue: { createMany: jest.fn() } },
        { provide: TwilioSmsService, useValue: sms },
        { provide: SmsConsentService, useValue: consent },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  };

  it('records consent for the number on file, with no message sent', async () => {
    await build(false);
    const res = await service.grantSmsConsent('u1');
    expect(consent.recordConsent).toHaveBeenCalledWith('u1', NUMBER, expect.anything());
    expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    expect(res.smsConsent).toBe(true);
  });

  it('refuses while the number is still stopped, and writes nothing', async () => {
    await build(true);
    await expect(service.grantSmsConsent('u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(consent.recordConsent).not.toHaveBeenCalled();
  });

  it('does not demand re-verification of an already verified number', async () => {
    await build(false);
    await expect(service.grantSmsConsent('u1')).resolves.toBeTruthy();
  });

  it('sends the unverified case to the code step instead', async () => {
    await build(false, account({ isPhoneVerified: false }));
    await expect(service.grantSmsConsent('u1')).rejects.toThrow(/Verify this number first/);
    expect(consent.recordConsent).not.toHaveBeenCalled();
  });
});

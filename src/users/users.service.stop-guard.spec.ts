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
  let consent: { recordConsent: jest.Mock; assertMaySend: jest.Mock };
  let sms: { sendVerificationCode: jest.Mock };

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
    consent = { recordConsent: jest.fn(), assertMaySend: jest.fn() };
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

  const send = (smsConsent?: boolean) =>
    service.sendPhoneVerificationCode('u1', {
      phoneNumber: '+14155550105',
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
    await send(true);
    expect(consent.recordConsent).toHaveBeenCalled();
    expect(consent.assertMaySend).toHaveBeenCalled();
    expect(sms.sendVerificationCode).toHaveBeenCalled();
  });
});

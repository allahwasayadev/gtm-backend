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
 * PATCH /users/profile carries only a JWT, and AdminAuthGuard trusts the roles
 * the JWT strategy reloads from the database. So whatever this method writes to
 * `roles` is, in effect, the permission decision.
 *
 * Two things must hold, and neither may be left to the client:
 *   - nobody can hand themselves Admin through the profile form;
 *   - an existing Admin is not demoted by a form that only ever posts one
 *     business role.
 */
describe('UsersService.updateProfile — roles are server-authoritative', () => {
  let service: UsersService;
  let repo: { findById: jest.Mock; findByEmail: jest.Mock; update: jest.Mock };

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'dana@harbour.test',
    name: 'Dana Whitfield',
    company: 'Northwind Systems',
    roles: ['OEM'],
    phoneNumber: '+14155550142',
    isPhoneVerified: true,
    ...over,
  });

  const writtenRoles = () => repo.update.mock.calls[0][1].roles;

  beforeEach(async () => {
    repo = {
      findById: jest.fn().mockResolvedValue(account()),
      findByEmail: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation((_id, data) => ({ ...account(), ...data })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: PrismaService, useValue: {} },
        { provide: ConnectionsRepository, useValue: { findAcceptedConnectionUserIds: jest.fn().mockResolvedValue([]) } },
        { provide: NotificationsService, useValue: { createMany: jest.fn(), notifyProfileChange: jest.fn() } },
        { provide: TwilioSmsService, useValue: { sendVerificationCode: jest.fn() } },
        { provide: SmsConsentService, useValue: { assertMaySend: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('refuses an ordinary user who asks for Admin, and writes nothing', async () => {
    await expect(
      service.updateProfile('u1', { roles: ['Admin', 'OEM'] } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses Admin even when it is the only role asked for', async () => {
    await expect(
      service.updateProfile('u1', { roles: ['Admin'] } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('still lets an ordinary user change their business role', async () => {
    await service.updateProfile('u1', { roles: ['Reseller'] } as any);
    expect(writtenRoles()).toEqual(['Reseller']);
  });

  it('keeps an existing Admin when the form posts one business role', async () => {
    repo.findById.mockResolvedValue(account({ roles: ['OEM', 'Admin'] }));
    await service.updateProfile('u1', { roles: ['Reseller'] } as any);
    expect(writtenRoles()).toEqual(['Reseller', 'Admin']);
  });

  it('lets an existing Admin post Admin without it becoming a grant', async () => {
    repo.findById.mockResolvedValue(account({ roles: ['OEM', 'Admin'] }));
    await service.updateProfile('u1', { roles: ['Admin', 'OEM'] } as any);
    expect(writtenRoles()).toEqual(['OEM', 'Admin']);
  });

  it('leaves roles alone entirely when the form does not send them', async () => {
    await service.updateProfile('u1', { name: 'Dana W' } as any);
    expect(repo.update.mock.calls[0][1]).not.toHaveProperty('roles');
  });
});

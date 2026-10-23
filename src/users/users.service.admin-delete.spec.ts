import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';

/**
 * DELETE /users/:id (deleteUserAsAdmin) carries only the admin's JWT, so
 * adminUserId is the real caller. The admin Users screen hides the delete
 * control for the signed-in row; the server must enforce the same so a crafted
 * request cannot delete the caller's own account. Other-user deletion and the
 * ordinary self-closure route (DELETE /users/profile) are untouched.
 */
describe('UsersService.deleteUserAsAdmin — admin cannot delete self', () => {
  let service: UsersService;
  let repo: { findById: jest.Mock; delete: jest.Mock };

  const admin = {
    id: 'admin1',
    email: 'admin@harbour.test',
    roles: ['OEM', 'Admin'],
  };
  const target = {
    id: 'target1',
    email: 'victim@harbour.test',
    roles: ['Reseller'],
  };

  beforeEach(async () => {
    repo = {
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          id === 'admin1' ? admin : id === 'target1' ? target : null,
        ),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: PrismaService, useValue: {} },
        {
          provide: ConnectionsRepository,
          useValue: {
            findAcceptedConnectionUserIds: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: NotificationsService, useValue: {} },
        { provide: TwilioSmsService, useValue: {} },
        { provide: SmsConsentService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('rejects an admin deleting their own account, writing nothing', async () => {
    await expect(
      service.deleteUserAsAdmin('admin1', 'admin1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('still deletes a different user for an admin', async () => {
    await expect(
      service.deleteUserAsAdmin('admin1', 'target1'),
    ).resolves.toEqual({ message: 'User deleted successfully' });
    expect(repo.delete).toHaveBeenCalledWith('target1');
  });

  it('still requires the caller to be an admin', async () => {
    await expect(
      service.deleteUserAsAdmin('target1', 'admin1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

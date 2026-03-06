import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async findAllSafe(): Promise<Pick<User, 'id' | 'email' | 'name' | 'company' | 'roles' | 'createdAt'>[]> {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        roles: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: any): Promise<User> {
    return (this.prisma.user as any).update({
      where: { id },
      data,
    });
  }

  async incrementPhoneVerificationAttempts(id: string): Promise<User> {
    return (this.prisma.user as any).update({
      where: { id },
      data: {
        phoneVerificationAttempts: { increment: 1 },
      },
    });
  }

  async markOnboardingComplete(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        hasCompletedOnboarding: true,
      },
    });
  }

  /**
   * Delete user and all associated records across all tables.
   * Cleans: in-app notifications, overlap-notification claims, account_match_decisions,
   * connections, invites (sent + clear acceptedBy), account_lists (+ accounts via FK),
   * then the user. So after delete, re-signup + upload + reconnect only shows new notifications.
   * Runs in a transaction so all-or-nothing.
   */
  async delete(id: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const connectionIds = await tx.connection
        .findMany({
          where: { OR: [{ senderId: id }, { receiverId: id }] },
          select: { id: true },
        })
        .then((rows) => rows.map((r) => r.id));

      await tx.notification.deleteMany({ where: { userId: id } });
      await (tx as any).observedOverlapNotification.deleteMany({
        where: {
          OR: [
            { userId: id },
            ...(connectionIds.length > 0
              ? [{ connectionId: { in: connectionIds } }]
              : []),
          ],
        },
      });
      if (connectionIds.length > 0) {
        await (tx as any).accountMatchDecision.deleteMany({
          where: { connectionId: { in: connectionIds } },
        });
      }
      await tx.connection.deleteMany({
        where: { OR: [{ senderId: id }, { receiverId: id }] },
      });
      await tx.invite.updateMany({
        where: { acceptedByUserId: id },
        data: { acceptedByUserId: null },
      });
      await tx.invite.deleteMany({ where: { invitedByUserId: id } });
      await tx.accountList.deleteMany({ where: { userId: id } });

      return tx.user.delete({
        where: { id },
      });
    });
  }
}

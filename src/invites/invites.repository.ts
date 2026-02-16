import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvitesRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    invitedEmail: string;
    invitedName?: string;
    invitedByUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.invite.create({
      data,
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true, company: true },
        },
      },
    });
  }

  async findByTokenHash(tokenHash: string) {
    return this.prisma.invite.findUnique({
      where: { tokenHash },
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true, company: true },
        },
      },
    });
  }

  async findByInviter(userId: string) {
    return this.prisma.invite.findMany({
      where: { invitedByUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findExistingPendingInvite(invitedByUserId: string, invitedEmail: string) {
    return this.prisma.invite.findFirst({
      where: {
        invitedByUserId,
        invitedEmail,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    acceptedByUserId?: string,
  ) {
    return this.prisma.invite.update({
      where: { id },
      data: {
        status,
        ...(acceptedByUserId && {
          acceptedByUserId,
          acceptedAt: new Date(),
        }),
      },
    });
  }

  async countRecentByUser(userId: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.invite.count({
      where: {
        invitedByUserId: userId,
        createdAt: { gte: oneDayAgo },
      },
    });
  }
}

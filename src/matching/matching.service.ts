import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MatchedAccount {
  accountName: string;
  yourAccountId: string;
  theirAccountId: string;
  type: string | null;
  theirType: string | null;
}

@Injectable()
export class MatchingService {
  constructor(private prisma: PrismaService) {}

  async getMatches(userId: string, connectionId: string): Promise<MatchedAccount[]> {
    const connection = await this.prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'accepted',
      },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found or not accepted');
    }

    const otherUserId =
      connection.senderId === userId ? connection.receiverId : connection.senderId;

    const [yourActiveList, theirActiveList] = await Promise.all([
      this.prisma.accountList.findFirst({
        where: { userId, status: 'active' },
        include: { accounts: true },
      }),
      this.prisma.accountList.findFirst({
        where: { userId: otherUserId, status: 'active' },
        include: { accounts: true },
      }),
    ]);

    if (!yourActiveList) {
      return [];
    }

    if (!theirActiveList) {
      return [];
    }

    const matches: MatchedAccount[] = [];
    const theirAccountsMap = new Map(
      theirActiveList.accounts.map((account) => [account.normalizedName, account]),
    );

    for (const yourAccount of yourActiveList.accounts) {
      const theirAccount = theirAccountsMap.get(yourAccount.normalizedName);
      if (theirAccount) {
        matches.push({
          accountName: yourAccount.accountName,
          yourAccountId: yourAccount.id,
          theirAccountId: theirAccount.id,
          type: yourAccount.type,
          theirType: theirAccount.type,
        });
      }
    }

    return matches;
  }
}

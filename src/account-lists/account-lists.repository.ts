import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountList, Account } from '@prisma/client';

export interface AccountListWithAccounts extends AccountList {
  accounts: Account[];
}

export interface AccountListWithCount extends AccountList {
  _count: {
    accounts: number;
  };
}

@Injectable()
export class AccountListsRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    userId: string;
    name: string;
    status: string;
  }): Promise<AccountList> {
    return this.prisma.accountList.create({
      data,
    });
  }

  async createAccounts(
    accounts: Array<{
      accountListId: string;
      accountName: string;
      normalizedName: string;
      type?: string | null;
    }>,
  ): Promise<{ count: number }> {
    return this.prisma.account.createMany({
      data: accounts,
    });
  }

  async findOneWithAccounts(
    listId: string,
    userId: string,
  ): Promise<AccountListWithAccounts | null> {
    return this.prisma.accountList.findFirst({
      where: {
        id: listId,
        userId,
      },
      include: {
        accounts: true,
      },
    });
  }

  async findAllByUser(userId: string): Promise<AccountListWithCount[]> {
    return this.prisma.accountList.findMany({
      where: { userId },
      include: {
        _count: {
          select: { accounts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(listId: string, status: string): Promise<AccountList> {
    return this.prisma.accountList.update({
      where: { id: listId },
      data: { status },
    });
  }

  async deleteAccounts(accountListId: string): Promise<{ count: number }> {
    return this.prisma.account.deleteMany({
      where: { accountListId },
    });
  }

  async delete(listId: string): Promise<AccountList> {
    return this.prisma.accountList.delete({
      where: { id: listId },
    });
  }

  async findFirstActive(
    userId: string,
  ): Promise<AccountListWithAccounts | null> {
    return this.prisma.accountList.findFirst({
      where: { userId, status: 'active' },
      include: { accounts: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
}

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountListDto, UpdateAccountsDto } from './dto';
import { parseAccountsFile } from '../common/utils/file-parser.util';
import { normalizeAccountName } from '../common/utils/normalize.util';

@Injectable()
export class AccountListsService {
  constructor(private prisma: PrismaService) {}

  async uploadFile(userId: string, file: Express.Multer.File, listName: string) {
    const parsedAccounts = await parseAccountsFile(file.buffer, file.mimetype);

    const accountList = await this.prisma.accountList.create({
      data: {
        userId,
        name: listName,
        status: 'draft',
      },
    });

    const accountsWithNormalizedNames = parsedAccounts.map((account) => ({
      accountListId: accountList.id,
      accountName: account.accountName,
      normalizedName: normalizeAccountName(account.accountName),
    }));

    await this.prisma.account.createMany({
      data: accountsWithNormalizedNames,
    });

    return this.getAccountListWithAccounts(accountList.id, userId);
  }

  async getAccountListWithAccounts(listId: string, userId: string) {
    const accountList = await this.prisma.accountList.findFirst({
      where: {
        id: listId,
        userId,
      },
      include: {
        accounts: {
          select: {
            id: true,
            accountName: true,
            type: true,
          },
        },
      },
    });

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    return accountList;
  }

  async updateAccounts(listId: string, userId: string, updateAccountsDto: UpdateAccountsDto) {
    const accountList = await this.prisma.accountList.findFirst({
      where: {
        id: listId,
        userId,
      },
    });

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.prisma.account.deleteMany({
      where: { accountListId: listId },
    });

    const accountsData = updateAccountsDto.accounts.map((account) => ({
      accountListId: listId,
      accountName: account.accountName,
      normalizedName: normalizeAccountName(account.accountName),
      type: account.type || null,
    }));

    await this.prisma.account.createMany({
      data: accountsData,
    });

    return this.getAccountListWithAccounts(listId, userId);
  }

  async publishAccountList(listId: string, userId: string) {
    const accountList = await this.prisma.accountList.findFirst({
      where: {
        id: listId,
        userId,
      },
    });

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.prisma.accountList.update({
      where: { id: listId },
      data: { status: 'active' },
    });

    return { message: 'Account list published successfully' };
  }

  async getUserAccountLists(userId: string) {
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

  async deleteAccountList(listId: string, userId: string) {
    const accountList = await this.prisma.accountList.findFirst({
      where: {
        id: listId,
        userId,
      },
    });

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.prisma.accountList.delete({
      where: { id: listId },
    });

    return { message: 'Account list deleted successfully' };
  }
}

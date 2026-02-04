import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AccountListsRepository } from './account-lists.repository';
import { CreateAccountListDto, UpdateAccountsDto } from './dto';
import { parseAccountsFile } from '../common/utils/file-parser.util';
import { normalizeAccountName } from '../common/utils/normalize.util';

@Injectable()
export class AccountListsService {
  constructor(private accountListsRepository: AccountListsRepository) {}

  async uploadFile(userId: string, file: Express.Multer.File, listName: string) {
    const parsedAccounts = await parseAccountsFile(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    const accountList = await this.accountListsRepository.create({
      userId,
      name: listName,
      status: 'draft',
    });

    const accountsWithNormalizedNames = parsedAccounts.map((account) => ({
      accountListId: accountList.id,
      accountName: account.accountName,
      normalizedName: normalizeAccountName(account.accountName),
    }));

    await this.accountListsRepository.createAccounts(accountsWithNormalizedNames);

    return this.getAccountListWithAccounts(accountList.id, userId);
  }

  async getAccountListWithAccounts(listId: string, userId: string) {
    const accountList = await this.accountListsRepository.findOneWithAccounts(
      listId,
      userId,
    );

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    return accountList;
  }

  async updateAccounts(listId: string, userId: string, updateAccountsDto: UpdateAccountsDto) {
    const accountList = await this.accountListsRepository.findOneWithAccounts(
      listId,
      userId,
    );

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.accountListsRepository.deleteAccounts(listId);

    const accountsData = updateAccountsDto.accounts.map((account) => ({
      accountListId: listId,
      accountName: account.accountName,
      normalizedName: normalizeAccountName(account.accountName),
      type: account.type || null,
    }));

    await this.accountListsRepository.createAccounts(accountsData);

    return this.getAccountListWithAccounts(listId, userId);
  }

  async publishAccountList(listId: string, userId: string) {
    const accountList = await this.accountListsRepository.findOneWithAccounts(
      listId,
      userId,
    );

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.accountListsRepository.updateStatus(listId, 'active');

    return { message: 'Account list published successfully' };
  }

  async getUserAccountLists(userId: string) {
    return this.accountListsRepository.findAllByUser(userId);
  }

  async deleteAccountList(listId: string, userId: string) {
    const accountList = await this.accountListsRepository.findOneWithAccounts(
      listId,
      userId,
    );

    if (!accountList) {
      throw new NotFoundException('Account list not found');
    }

    await this.accountListsRepository.delete(listId);

    return { message: 'Account list deleted successfully' };
  }
}

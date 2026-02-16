import { Controller, Get, Param, UseGuards, Request, NotFoundException } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { AccountListsRepository } from '../account-lists/account-lists.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { PartnerAccountData } from './matching.service';

@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(
    private matchingService: MatchingService,
    private connectionsRepository: ConnectionsRepository,
    private accountListsRepository: AccountListsRepository,
  ) {}

  @Get('all-matches')
  async getAllMatches(@Request() req: any) {
    const userId = req.user.id;

    const activeList = await this.accountListsRepository.findFirstActive(userId);
    if (!activeList || !activeList.accounts.length) {
      return {};
    }

    const connections = await this.connectionsRepository.findAllAcceptedByUser(userId);
    if (!connections.length) {
      return {};
    }

    const partnerDataPromises = connections.map(async (connection) => {
      const otherUser =
        connection.senderId === userId ? connection.receiver : connection.sender;
      const otherUserId =
        connection.senderId === userId ? connection.receiverId : connection.senderId;

      const theirActiveList =
        await this.accountListsRepository.findFirstActive(otherUserId);

      if (!theirActiveList || !theirActiveList.accounts.length) {
        return null;
      }

      return {
        partnerName: otherUser.name,
        partnerCompany: otherUser.company,
        theirAccounts: theirActiveList.accounts,
      } as PartnerAccountData;
    });

    const partnerResults = await Promise.all(partnerDataPromises);
    const partners = partnerResults.filter(
      (p): p is PartnerAccountData => p !== null,
    );

    return this.matchingService.buildAccountMatchesMap(
      activeList.accounts,
      partners,
    );
  }

  @Get('connections/:connectionId')
  async getMatches(@Param('connectionId') connectionId: string, @Request() req: any) {
    const userId = req.user.id;

    const connection = await this.connectionsRepository.findAcceptedConnection(
      connectionId,
      userId,
    );

    if (!connection) {
      throw new NotFoundException('Connection not found or not accepted');
    }

    const otherUserId =
      connection.senderId === userId ? connection.receiverId : connection.senderId;

    const [yourActiveList, theirActiveList] = await Promise.all([
      this.accountListsRepository.findFirstActive(userId),
      this.accountListsRepository.findFirstActive(otherUserId),
    ]);

    const yourAccounts = yourActiveList?.accounts || [];
    const theirAccounts = theirActiveList?.accounts || [];

    return this.matchingService.findMatches(yourAccounts, theirAccounts);
  }
}

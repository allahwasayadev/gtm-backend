import { Controller, Get, Param, UseGuards, Request, NotFoundException } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { AccountListsRepository } from '../account-lists/account-lists.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(
    private matchingService: MatchingService,
    private connectionsRepository: ConnectionsRepository,
    private accountListsRepository: AccountListsRepository,
  ) {}

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

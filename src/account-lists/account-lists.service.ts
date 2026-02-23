import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Connection } from '@prisma/client';
import { AccountListsRepository } from './account-lists.repository';
import { UpdateAccountsDto } from './dto';
import { parseAccountsFile } from '../common/utils/file-parser.util';
import { normalizeAccountName } from '../common/utils/normalize.util';
import { ConnectionsRepository } from '../connections/connections.repository';
import { MatchingService } from '../matching/matching.service';
import { MatchDecisionsRepository, type MatchDecisionType } from '../matching/match-decisions.repository';
import type { MatchDecisionPair } from '../common/utils/account-matching.util';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AccountListsService {
  private readonly logger = new Logger(AccountListsService.name);

  constructor(
    private accountListsRepository: AccountListsRepository,
    private connectionsRepository: ConnectionsRepository,
    private matchingService: MatchingService,
    private matchDecisionsRepository: MatchDecisionsRepository,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
  ) {}

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

    if (accountList.status === 'active') {
      void this.remapConnectionsAndNotifyInBackground(userId);
    }

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

    await this.accountListsRepository.archiveAllUserLists(userId, listId);
    await this.accountListsRepository.updateStatus(listId, 'active');
    void this.remapConnectionsAndNotifyInBackground(userId);

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

  private async remapConnectionsAndNotifyInBackground(userId: string) {
    try {
      const connections = await this.connectionsRepository.findAllAcceptedByUser(userId);
      if (!connections.length) return;

      await Promise.all(
        connections.map(async (connection) => {
          const isCurrentUserSender = this.isCurrentUserSender(connection, userId);
          const otherUserId = isCurrentUserSender
            ? connection.receiverId
            : connection.senderId;

          const [yourActiveList, theirActiveList, decisions] = await Promise.all([
            this.accountListsRepository.findFirstActive(userId),
            this.accountListsRepository.findFirstActive(otherUserId),
            this.matchDecisionsRepository.findByConnection(connection.id),
          ]);

          const decisionOptions = this.toDecisionOptions( decisions, isCurrentUserSender );
          const categorizedMatches = this.matchingService.findMatches( yourActiveList?.accounts ?? [], theirActiveList?.accounts ?? [], decisionOptions );

          const resolvedCount = categorizedMatches.resolved.length;
          const hadAutoUnmute = await this.autoUnmuteEligibleUsers( connection, resolvedCount );
          const didSendNewOverlapNotification =
            await this.handleSharedMatchCountChange(connection, resolvedCount);

          if (hadAutoUnmute && !didSendNewOverlapNotification) {
            void this.sendNewOverlapNotifications(connection);
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed background re-map for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async handleSharedMatchCountChange( connection: ConnectionWithUsersState, currentSharedCount: number ): Promise<boolean> {
    const previousSharedCount = connection.lastObservedSharedMatchCount ?? null;

    if (previousSharedCount === null) {
      await this.connectionsRepository.updateLastObservedSharedMatchCount( connection.id, currentSharedCount );
      connection.lastObservedSharedMatchCount = currentSharedCount;
      return false;
    }

    if (currentSharedCount === previousSharedCount) return false;

    if (currentSharedCount < previousSharedCount) {
      const synced = await this.connectionsRepository.claimSharedMatchCountUpdate( connection.id, previousSharedCount, currentSharedCount );
      if (!synced) return false;
      connection.lastObservedSharedMatchCount = currentSharedCount;
      return false;
    }

    const claimed = await this.connectionsRepository.claimSharedMatchCountUpdate( connection.id, previousSharedCount, currentSharedCount );

    if (!claimed) return false;

    connection.lastObservedSharedMatchCount = currentSharedCount;
    void this.sendNewOverlapNotifications(connection);
    return true;
  }

  private async autoUnmuteEligibleUsers( connection: ConnectionWithUsersState, currentSharedCount: number ): Promise<boolean> {
    let nextConnectionState: ConnectionWithUsersState = connection;
    let hasMutation = false;

    for (const userId of [connection.senderId, connection.receiverId]) {
      const mutedState = this.getMutedStateForUser(nextConnectionState, userId);
      if (!mutedState.isMuted) {
        continue;
      }

      if (currentSharedCount <= mutedState.mutedMatchCount) {
        continue;
      }

      const updatedConnection = await this.connectionsRepository.clearMutedForUser( nextConnectionState, userId );
      nextConnectionState = {
        ...nextConnectionState,
        ...updatedConnection,
      };
      hasMutation = true;
    }

    if (hasMutation) Object.assign(connection, nextConnectionState);

    return hasMutation;
  }

  private async sendNewOverlapNotifications( connection: ConnectionWithUsersState ): Promise<void> {
    try {
      const senderMuted = this.getMutedStateForUser( connection, connection.senderId ).isMuted;
      const receiverMuted = this.getMutedStateForUser( connection, connection.receiverId ).isMuted;

      const ctaUrl = `/dashboard/matches?connection=${connection.id}`;
      const recipients = [
        { userId: connection.sender.id, email: connection.sender.email, firstName: this.extractFirstName(connection.sender.name), connectionName: connection.receiver.name, muted: senderMuted },
        { userId: connection.receiver.id, email: connection.receiver.email, firstName: this.extractFirstName(connection.receiver.name), connectionName: connection.sender.name, muted: receiverMuted },
      ].filter((recipient) => !recipient.muted);

      if (!recipients.length) return;

      await Promise.all(
        recipients.map((recipient) =>
          this.emailService.sendNewOverlapsEmail( recipient.email, recipient.firstName, recipient.connectionName, `${process.env.FRONTEND_URL || 'http://localhost:3000'}${ctaUrl}` ),
        ),
      );

      await this.notificationsService.createNewOverlapNotifications( recipients.map((recipient) => ({ userId: recipient.userId, connectionName: recipient.connectionName, connectionId: connection.id })) );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch new overlap notifications for connection ${connection.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private extractFirstName(fullName: string): string {
    const normalized = fullName.trim();
    if (!normalized) return 'there';
    return normalized.split(/\s+/)[0];
  }

  private getMutedStateForUser( connection: {senderId: string; senderMutedAt?: Date | null; senderMutedMatchCount?: number | null; receiverMutedAt?: Date | null; receiverMutedMatchCount?: number | null}, userId: string ) {
    if (connection.senderId === userId) {
      return {
        isMuted: Boolean(connection.senderMutedAt),
        mutedMatchCount: Number(connection.senderMutedMatchCount ?? 0),
      };
    }

    return {
      isMuted: Boolean(connection.receiverMutedAt),
      mutedMatchCount: Number(connection.receiverMutedMatchCount ?? 0),
    };
  }

  private toDecisionOptions( decisions: Array<{ yourAccountId: string; theirAccountId: string; decision: MatchDecisionType }>, isCurrentUserSender: boolean ): { acceptedPairs: MatchDecisionPair[]; rejectedPairs: MatchDecisionPair[] } {
    const acceptedPairs: MatchDecisionPair[] = [];
    const rejectedPairs: MatchDecisionPair[] = [];

    for (const decision of decisions) {
      const pair: MatchDecisionPair = isCurrentUserSender
        ? { yourAccountId: decision.yourAccountId, theirAccountId: decision.theirAccountId }
        : { yourAccountId: decision.theirAccountId, theirAccountId: decision.yourAccountId };

      if (decision.decision === 'accepted') {
        acceptedPairs.push(pair);
      } else {
        rejectedPairs.push(pair);
      }
    }

    return { acceptedPairs, rejectedPairs };
  }

  private isCurrentUserSender( connection: { senderId: string }, userId: string ): boolean {
    return connection.senderId === userId;
  }
}

interface ConnectionWithUsersState extends Connection {
  sender: {
    id: string;
    name: string;
    email: string;
  };
  receiver: {
    id: string;
    name: string;
    email: string;
  };
}

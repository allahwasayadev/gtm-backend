import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Account, Connection } from '@prisma/client';
import { AccountListsRepository } from './account-lists.repository';
import { UpdateAccountsDto } from './dto';
import { parseAccountsFile } from '../common/utils/file-parser.util';
import { normalizeAccountName } from '../common/utils/normalize.util';
import { jaroWinkler } from '../common/utils/similarity.util';
import { ConnectionsRepository } from '../connections/connections.repository';
import { MatchingService } from '../matching/matching.service';
import { MatchDecisionsRepository, type MatchDecisionType } from '../matching/match-decisions.repository';
import type { MatchDecisionPair, MatchedAccountResult } from '../common/utils/account-matching.util';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { ObservedOverlapNotificationsRepository, type ObservedOverlapNotificationClaim } from '../matching/observed-overlap-notifications.repository';

@Injectable()
export class AccountListsService {
  private readonly logger = new Logger(AccountListsService.name);

  constructor(
    private accountListsRepository: AccountListsRepository,
    private connectionsRepository: ConnectionsRepository,
    private matchingService: MatchingService,
    private matchDecisionsRepository: MatchDecisionsRepository,
    private notificationsService: NotificationsService,
    private observedOverlapNotificationsRepository: ObservedOverlapNotificationsRepository,
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

    if (accountList.status === 'active') {
      await this.connectionsRepository.resetLastObservedSharedMatchCountForUser( userId );
    }

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

          const decisionOptions = this.toDecisionOptions(
            decisions,
            isCurrentUserSender,
            yourActiveList?.accounts ?? [],
            theirActiveList?.accounts ?? [],
          );
          const categorizedMatches = this.matchingService.findMatches( yourActiveList?.accounts ?? [], theirActiveList?.accounts ?? [], decisionOptions );

          const resolvedCount = categorizedMatches.resolved.length;
          const mutedRecipientUserIdsAtDiscovery = new Set<string>();
          if (this.getMutedStateForUser(connection, connection.senderId).isMuted) {
            mutedRecipientUserIdsAtDiscovery.add(connection.senderId);
          }
          if (this.getMutedStateForUser(connection, connection.receiverId).isMuted) {
            mutedRecipientUserIdsAtDiscovery.add(connection.receiverId);
          }

          await this.autoUnmuteEligibleUsers( connection, resolvedCount );
          const didIncreaseSharedMatches = await this.handleSharedMatchCountChange(connection, resolvedCount);

          if (didIncreaseSharedMatches) {
            void this.sendNewOverlapNotifications(
              connection,
              this.buildResolvedMatchNotificationContext({
                resolvedMatches: categorizedMatches.resolved,
                yourAccounts: yourActiveList?.accounts ?? [],
                theirAccounts: theirActiveList?.accounts ?? [],
                isCurrentUserSender,
                acceptedDecisionSnapshotPairsByCurrentPairKey:
                  decisionOptions.acceptedDecisionSnapshotPairsByCurrentPairKey,
              }),
              mutedRecipientUserIdsAtDiscovery,
            );
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

  private async sendNewOverlapNotifications( connection: ConnectionWithUsersState, context: ResolvedMatchNotificationContext, mutedRecipientUserIdsAtDiscovery: ReadonlySet<string> = new Set() ): Promise<void> {
    try {
      if (!context.resolvedMatches.length) return;
      const senderMuted = this.getMutedStateForUser( connection, connection.senderId ).isMuted;
      const receiverMuted = this.getMutedStateForUser( connection, connection.receiverId ).isMuted;

      const ctaUrl = `/dashboard/matches?connection=${connection.id}`;
      const recipients = [
        { userId: connection.sender.id, email: connection.sender.email, firstName: this.extractFirstName(connection.sender.name), connectionName: connection.receiver.name, muted: senderMuted, side: 'sender' as const },
        { userId: connection.receiver.id, email: connection.receiver.email, firstName: this.extractFirstName(connection.receiver.name), connectionName: connection.sender.name, muted: receiverMuted, side: 'receiver' as const },
      ].map((recipient) => ({ ...recipient, mutedAtDiscovery: mutedRecipientUserIdsAtDiscovery.has(recipient.userId) }));

      const notificationCandidates = this.buildOverlapNotificationCandidates( connection, recipients, context );
      if (!notificationCandidates.length) return;

      const newlyClaimed =
        await this.observedOverlapNotificationsRepository.claimNew( notificationCandidates.map((candidate) => ({ userId: candidate.userId, connectionId: candidate.connectionId, senderNormalizedName: candidate.senderNormalizedName, receiverNormalizedName: candidate.receiverNormalizedName })) );

      if (!newlyClaimed.length) return;

      const claimedKeys = new Set( newlyClaimed.map((claim) => this.toObservedOverlapClaimKey(claim)) );
      const newOverlapNotifications = notificationCandidates.filter((candidate) => claimedKeys.has(this.toObservedOverlapClaimKey(candidate)) );

      if (!newOverlapNotifications.length) return;

      const recipientsByUserId = new Map( recipients.map((recipient) => [recipient.userId, recipient]) );
      const deliverableNotifications = newOverlapNotifications.filter((item) => {
        const recipient = recipientsByUserId.get(item.userId);
        if (!recipient) {
          return false;
        }

        return !recipient.muted && !recipient.mutedAtDiscovery;
      });

      if (!deliverableNotifications.length) return;

      const recipientsWithNewNotifications = Array.from( new Set(deliverableNotifications.map((item) => item.userId)) ).map((userId) => recipientsByUserId.get(userId)).filter((recipient): recipient is OverlapNotificationRecipient => Boolean(recipient) );

      await Promise.all(
        recipientsWithNewNotifications.map((recipient) => this.emailService.sendNewOverlapsEmail( recipient.email, recipient.firstName, recipient.connectionName, `${process.env.FRONTEND_URL || 'http://localhost:3000'}${ctaUrl}` ) ),
      );

      await this.notificationsService.createNewOverlapNotifications( deliverableNotifications.map((notification) => ({ userId: notification.userId, connectionName: notification.connectionName, connectionId: notification.connectionId, accountName: notification.accountName, partnerAccountName: notification.partnerAccountName })) );
    } catch (error) {
      this.logger.error( `Failed to dispatch new overlap notifications for connection ${connection.id}`, error instanceof Error ? error.stack : undefined );
    }
  }

  private extractFirstName(fullName: string): string {
    const normalized = fullName.trim();
    if (!normalized) return 'there';
    return normalized.split(/\s+/)[0];
  }

  private buildResolvedMatchNotificationContext(params: {
    resolvedMatches: MatchedAccountResult[];
    yourAccounts: Account[];
    theirAccounts: Account[];
    isCurrentUserSender: boolean;
    acceptedDecisionSnapshotPairsByCurrentPairKey: Map<
      string,
      CanonicalNormalizedNamePair
    >;
  }): ResolvedMatchNotificationContext {
    return {
      resolvedMatches: params.resolvedMatches,
      yourAccountsById: new Map( params.yourAccounts.map((account) => [account.id, account]) ),
      theirAccountsById: new Map( params.theirAccounts.map((account) => [account.id, account]) ),
      isCurrentUserSender: params.isCurrentUserSender,
      acceptedDecisionSnapshotPairsByCurrentPairKey:
        params.acceptedDecisionSnapshotPairsByCurrentPairKey,
    };
  }

  private buildOverlapNotificationCandidates( connection: ConnectionWithUsersState, recipients: OverlapNotificationRecipient[], context: ResolvedMatchNotificationContext ): OverlapNotificationCandidate[] {
    const candidates: OverlapNotificationCandidate[] = [];

    for (const match of context.resolvedMatches) {
      const yourAccount = context.yourAccountsById.get(match.yourAccountId);
      const theirAccount = context.theirAccountsById.get(match.theirAccountId);

      if (!yourAccount || !theirAccount) {
        continue;
      }

      const senderAccount = context.isCurrentUserSender ? yourAccount : theirAccount;
      const receiverAccount = context.isCurrentUserSender ? theirAccount : yourAccount;
      const acceptedSnapshotPair =
        match.matchType === 'accepted'
          ? context.acceptedDecisionSnapshotPairsByCurrentPairKey.get(
              this.toCurrentMatchPairKey(match.yourAccountId, match.theirAccountId),
            )
          : undefined;

      for (const recipient of recipients) {
        const isSenderRecipient = recipient.side === 'sender';
        const accountName = isSenderRecipient
          ? senderAccount.accountName
          : receiverAccount.accountName;
        const partnerAccountName = isSenderRecipient
          ? receiverAccount.accountName
          : senderAccount.accountName;

        candidates.push({
          userId: recipient.userId,
          connectionId: connection.id,
          connectionName: recipient.connectionName,
          accountName,
          partnerAccountName,
          senderNormalizedName:
            acceptedSnapshotPair?.senderNormalizedName ??
            senderAccount.normalizedName,
          receiverNormalizedName:
            acceptedSnapshotPair?.receiverNormalizedName ??
            receiverAccount.normalizedName,
        });
      }
    }

    return candidates;
  }

  private toObservedOverlapClaimKey( claim: ObservedOverlapNotificationClaim ): string {
    return `${claim.userId}::${claim.connectionId}::${claim.senderNormalizedName}::${claim.receiverNormalizedName}`;
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

  private toDecisionOptions(
    decisions: Array<{
      yourAccountId: string;
      theirAccountId: string;
      yourNormalizedNameSnapshot?: string | null;
      theirNormalizedNameSnapshot?: string | null;
      decision: MatchDecisionType;
    }>,
    isCurrentUserSender: boolean,
    yourAccounts: Account[],
    theirAccounts: Account[],
  ): DecisionOptionsWithRemap {
    const yourAccountIds = new Set(yourAccounts.map((account) => account.id));
    const theirAccountIds = new Set(theirAccounts.map((account) => account.id));
    const acceptedPairs: MatchDecisionPair[] = [];
    const rejectedPairs: MatchDecisionPair[] = [];
    const acceptedDecisionSnapshotPairsByCurrentPairKey = new Map<
      string,
      CanonicalNormalizedNamePair
    >();

    for (const decision of decisions) {
      const snapshotPair = this.toCurrentUserSnapshotPair(
        decision,
        isCurrentUserSender,
      );
      const pair = this.resolveDecisionPairForCurrentAccounts(decision, {
        isCurrentUserSender,
        yourAccountIds,
        theirAccountIds,
        yourAccounts,
        theirAccounts,
        snapshotPair,
      });

      if (!pair) {
        continue;
      }

      if (decision.decision === 'accepted') {
        acceptedPairs.push(pair);
        const canonicalSnapshotPair = this.toCanonicalNormalizedNamePair(
          snapshotPair,
          pair,
          isCurrentUserSender,
          yourAccounts,
          theirAccounts,
        );

        if (canonicalSnapshotPair) {
          acceptedDecisionSnapshotPairsByCurrentPairKey.set(
            this.toCurrentMatchPairKey(pair.yourAccountId, pair.theirAccountId),
            canonicalSnapshotPair,
          );
        }
      } else {
        rejectedPairs.push(pair);
      }
    }

    return {
      acceptedPairs,
      rejectedPairs,
      acceptedDecisionSnapshotPairsByCurrentPairKey,
    };
  }

  private resolveDecisionPairForCurrentAccounts(
    decision: {
      yourAccountId: string;
      theirAccountId: string;
      yourNormalizedNameSnapshot?: string | null;
      theirNormalizedNameSnapshot?: string | null;
    },
    params: {
      isCurrentUserSender: boolean;
      yourAccountIds: Set<string>;
      theirAccountIds: Set<string>;
      yourAccounts: Account[];
      theirAccounts: Account[];
      snapshotPair: CurrentUserSnapshotPair;
    },
  ): MatchDecisionPair | null {
    const orientedPair: MatchDecisionPair = params.isCurrentUserSender
      ? {
          yourAccountId: decision.yourAccountId,
          theirAccountId: decision.theirAccountId,
        }
      : {
          yourAccountId: decision.theirAccountId,
          theirAccountId: decision.yourAccountId,
        };

    if (
      params.yourAccountIds.has(orientedPair.yourAccountId) &&
      params.theirAccountIds.has(orientedPair.theirAccountId)
    ) {
      return orientedPair;
    }

    const remappedYourAccount = this.findBestAccountForSnapshot(
      params.snapshotPair.yourNormalizedNameSnapshot,
      params.yourAccounts,
    );
    const remappedTheirAccount = this.findBestAccountForSnapshot(
      params.snapshotPair.theirNormalizedNameSnapshot,
      params.theirAccounts,
    );

    if (!remappedYourAccount || !remappedTheirAccount) {
      return null;
    }

    return {
      yourAccountId: remappedYourAccount.id,
      theirAccountId: remappedTheirAccount.id,
    };
  }

  private findBestAccountForSnapshot(
    snapshotNormalizedName: string | null | undefined,
    accounts: Account[],
  ): Account | null {
    if (!snapshotNormalizedName) {
      return null;
    }

    const exact = accounts.find(
      (account) => account.normalizedName === snapshotNormalizedName,
    );
    if (exact) {
      return exact;
    }

    let best: { account: Account; score: number } | null = null;
    for (const account of accounts) {
      const score = jaroWinkler(snapshotNormalizedName, account.normalizedName);
      if (score < 0.85) {
        continue;
      }
      if (!best || score > best.score) {
        best = { account, score };
      }
    }

    return best?.account ?? null;
  }

  private toCurrentUserSnapshotPair(
    decision: {
      yourNormalizedNameSnapshot?: string | null;
      theirNormalizedNameSnapshot?: string | null;
    },
    isCurrentUserSender: boolean,
  ): CurrentUserSnapshotPair {
    if (isCurrentUserSender) {
      return {
        yourNormalizedNameSnapshot: decision.yourNormalizedNameSnapshot ?? null,
        theirNormalizedNameSnapshot:
          decision.theirNormalizedNameSnapshot ?? null,
      };
    }

    return {
      yourNormalizedNameSnapshot: decision.theirNormalizedNameSnapshot ?? null,
      theirNormalizedNameSnapshot: decision.yourNormalizedNameSnapshot ?? null,
    };
  }

  private toCanonicalNormalizedNamePair(
    snapshotPair: CurrentUserSnapshotPair,
    currentPair: MatchDecisionPair,
    isCurrentUserSender: boolean,
    yourAccounts: Account[],
    theirAccounts: Account[],
  ): CanonicalNormalizedNamePair | null {
    const yourAccount = yourAccounts.find(
      (account) => account.id === currentPair.yourAccountId,
    );
    const theirAccount = theirAccounts.find(
      (account) => account.id === currentPair.theirAccountId,
    );

    const senderNormalizedName = isCurrentUserSender
      ? snapshotPair.yourNormalizedNameSnapshot ?? yourAccount?.normalizedName
      : snapshotPair.theirNormalizedNameSnapshot ?? theirAccount?.normalizedName;
    const receiverNormalizedName = isCurrentUserSender
      ? snapshotPair.theirNormalizedNameSnapshot ?? theirAccount?.normalizedName
      : snapshotPair.yourNormalizedNameSnapshot ?? yourAccount?.normalizedName;

    if (!senderNormalizedName || !receiverNormalizedName) {
      return null;
    }

    return {
      senderNormalizedName,
      receiverNormalizedName,
    };
  }

  private toCurrentMatchPairKey(yourAccountId: string, theirAccountId: string): string {
    return `${yourAccountId}::${theirAccountId}`;
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

interface ResolvedMatchNotificationContext {
  resolvedMatches: MatchedAccountResult[];
  yourAccountsById: Map<string, Account>;
  theirAccountsById: Map<string, Account>;
  isCurrentUserSender: boolean;
  acceptedDecisionSnapshotPairsByCurrentPairKey: Map<
    string,
    CanonicalNormalizedNamePair
  >;
}

interface OverlapNotificationRecipient {
  userId: string;
  email: string;
  firstName: string;
  connectionName: string;
  muted: boolean;
  mutedAtDiscovery: boolean;
  side: 'sender' | 'receiver';
}

interface OverlapNotificationCandidate extends ObservedOverlapNotificationClaim {
  connectionName: string;
  accountName: string;
  partnerAccountName: string;
}

interface CanonicalNormalizedNamePair {
  senderNormalizedName: string;
  receiverNormalizedName: string;
}

interface CurrentUserSnapshotPair {
  yourNormalizedNameSnapshot: string | null;
  theirNormalizedNameSnapshot: string | null;
}

interface DecisionOptionsWithRemap {
  acceptedPairs: MatchDecisionPair[];
  rejectedPairs: MatchDecisionPair[];
  acceptedDecisionSnapshotPairsByCurrentPairKey: Map<
    string,
    CanonicalNormalizedNamePair
  >;
}

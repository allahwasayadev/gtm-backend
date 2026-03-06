import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { Account } from '@prisma/client';
import { MatchingService } from './matching.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { AccountListsRepository } from '../account-lists/account-lists.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  PartnerAccountData,
  PartnerRelationshipType,
} from './matching.service';
import { MatchDecisionsRepository } from './match-decisions.repository';
import type { MatchDecisionType } from './match-decisions.repository';
import type {
  CategorizedMatches,
  MatchDecisionPair,
  MatchedAccountResult,
} from '../common/utils/account-matching.util';
import { SetMatchDecisionDto } from './dto';
import { jaroWinkler } from '../common/utils/similarity.util';
import {
  ObservedOverlapNotificationsRepository,
  type ObservedOverlapNotificationClaim,
} from './observed-overlap-notifications.repository';

@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  private readonly logger = new Logger(MatchingController.name);

  constructor(
    private matchingService: MatchingService,
    private connectionsRepository: ConnectionsRepository,
    private accountListsRepository: AccountListsRepository,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private matchDecisionsRepository: MatchDecisionsRepository,
    private observedOverlapNotificationsRepository: ObservedOverlapNotificationsRepository,
  ) {}

  @Get('all-matches')
  async getAllMatches(@Request() req: { user: { id: string } }) {
    const userId = req.user.id;

    const activeList =
      await this.accountListsRepository.findFirstActive(userId);
    if (!activeList || !activeList.accounts.length) {
      return this.matchingService.buildAllMatchesResponse([], []);
    }

    const connections =
      await this.connectionsRepository.findAllAcceptedByUser(userId);
    if (!connections.length) {
      return this.matchingService.buildAllMatchesResponse(
        activeList.accounts,
        [],
      );
    }

    const partnerDataPromises = connections.map(async (connection) => {
      const isCurrentUserSender = this.isCurrentUserSender(connection, userId);
      const otherUser = isCurrentUserSender
        ? connection.receiver
        : connection.sender;
      const otherUserId = isCurrentUserSender
        ? connection.receiverId
        : connection.senderId;

      const [theirActiveList, decisions] = await Promise.all([
        this.accountListsRepository.findFirstActive(otherUserId),
        this.matchDecisionsRepository.findByConnection(connection.id),
      ]);

      if (!theirActiveList || !theirActiveList.accounts.length) {
        return null;
      }

      const decisionOptions = this.toDecisionOptions(
        decisions,
        isCurrentUserSender,
        activeList.accounts,
        theirActiveList.accounts,
      );
      const categorizedMatches = this.matchingService.findMatches(
        activeList.accounts,
        theirActiveList.accounts,
        decisionOptions,
      );

      this.logMatchStats(
        otherUser.name,
        connection.id,
        activeList.accounts.length,
        theirActiveList.accounts.length,
        categorizedMatches,
      );

      const resolvedCount = categorizedMatches.resolved.length;
      const mutedRecipientUserIdsAtDiscovery = new Set<string>();
      if (this.getMutedStateForUser(connection, connection.senderId).isMuted) {
        mutedRecipientUserIdsAtDiscovery.add(connection.senderId);
      }
      if (
        this.getMutedStateForUser(connection, connection.receiverId).isMuted
      ) {
        mutedRecipientUserIdsAtDiscovery.add(connection.receiverId);
      }

      await this.autoUnmuteEligibleUsers(connection, resolvedCount);

      const mutedState = this.getMutedStateForUser(connection, userId);
      if (mutedState.isMuted) {
        return null;
      }

      const didIncreaseSharedMatches = await this.handleSharedMatchCountChange(
        connection,
        resolvedCount,
      );
      if (didIncreaseSharedMatches) {
        void this.sendNewOverlapNotifications(
          connection,
          this.buildResolvedMatchNotificationContext({
            resolvedMatches: categorizedMatches.resolved,
            yourAccounts: activeList.accounts,
            theirAccounts: theirActiveList.accounts,
            isCurrentUserSender,
            acceptedDecisionSnapshotPairsByCurrentPairKey:
              decisionOptions.acceptedDecisionSnapshotPairsByCurrentPairKey,
          }),
          mutedRecipientUserIdsAtDiscovery,
        );
      }

      const partnerRelationshipType: PartnerRelationshipType =
        otherUser.roles?.includes('OEM') ? 'OEM' : 'RESELLER';

      return {
        connectionId: connection.id,
        partnerName: otherUser.name,
        partnerCompany: otherUser.company,
        partnerRelationshipType,
        resolvedMatches: categorizedMatches.resolved,
        suggestedMatches: categorizedMatches.suggested,
      } as PartnerAccountData;
    });

    const partnerResults = await Promise.all(partnerDataPromises);
    const partners = partnerResults.filter(
      (partner): partner is PartnerAccountData => partner !== null,
    );

    return this.matchingService.buildAllMatchesResponse(
      activeList.accounts,
      partners,
    );
  }

  @Get('connections/:connectionId')
  async getMatches(
    @Param('connectionId') connectionId: string,
    @Request() req: { user: { id: string } },
  ) {
    const userId = req.user.id;
    const connection =
      await this.connectionsRepository.findAcceptedConnectionWithUsers(
        connectionId,
        userId,
      );

    if (!connection) {
      throw new NotFoundException('Connection not found or not accepted');
    }

    const isCurrentUserSender = this.isCurrentUserSender(connection, userId);
    const otherUserId = isCurrentUserSender
      ? connection.receiverId
      : connection.senderId;

    const [yourActiveList, theirActiveList, decisions] = await Promise.all([
      this.accountListsRepository.findFirstActive(userId),
      this.accountListsRepository.findFirstActive(otherUserId),
      this.matchDecisionsRepository.findByConnection(connectionId),
    ]);

    const yourAccounts = yourActiveList?.accounts ?? [];
    const theirAccounts = theirActiveList?.accounts ?? [];

    const categorizedMatches = this.matchingService.findMatches(yourAccounts, theirAccounts, this.toDecisionOptions(decisions, isCurrentUserSender, yourAccounts, theirAccounts));

    const otherUser = isCurrentUserSender ? (connection as { receiver: { name: string } }).receiver : (connection as { sender: { name: string } }).sender
    this.logMatchStats(otherUser.name, connectionId, yourAccounts.length, theirAccounts.length, categorizedMatches);
    return categorizedMatches;
  }

  @Post('connections/:connectionId/decisions')
  async setMatchDecision(
    @Param('connectionId') connectionId: string,
    @Request() req: { user: { id: string } },
    @Body() dto: SetMatchDecisionDto,
  ) {
    const userId = req.user.id;
    const connection =
      await this.connectionsRepository.findAcceptedConnectionWithUsers(
        connectionId,
        userId,
      );

    if (!connection) {
      throw new NotFoundException('Connection not found or not accepted');
    }

    const isCurrentUserSender = this.isCurrentUserSender(connection, userId);
    const otherUserId = isCurrentUserSender
      ? connection.receiverId
      : connection.senderId;

    const [yourActiveList, theirActiveList] = await Promise.all([
      this.accountListsRepository.findFirstActive(userId),
      this.accountListsRepository.findFirstActive(otherUserId),
    ]);

    const yourAccountIds = new Set(
      (yourActiveList?.accounts ?? []).map((account) => account.id),
    );
    const theirAccountIds = new Set(
      (theirActiveList?.accounts ?? []).map((account) => account.id),
    );
    const yourAccountsById = new Map(
      (yourActiveList?.accounts ?? []).map((account) => [account.id, account]),
    );
    const theirAccountsById = new Map(
      (theirActiveList?.accounts ?? []).map((account) => [account.id, account]),
    );

    if (!yourAccountIds.has(dto.yourAccountId)) {
      throw new BadRequestException(
        'Invalid yourAccountId for this connection',
      );
    }
    if (!theirAccountIds.has(dto.theirAccountId)) {
      throw new BadRequestException(
        'Invalid theirAccountId for this connection',
      );
    }

    const canonicalPair = this.toCanonicalPair(
      connection,
      userId,
      dto.yourAccountId,
      dto.theirAccountId,
    );
    const canonicalYourAccount =
      connection.senderId === userId
        ? yourAccountsById.get(dto.yourAccountId)
        : theirAccountsById.get(dto.theirAccountId);
    const canonicalTheirAccount =
      connection.senderId === userId
        ? theirAccountsById.get(dto.theirAccountId)
        : yourAccountsById.get(dto.yourAccountId);

    let previousResolvedCount: number | null = null;
    if (dto.decision === 'accepted') {
      const previousDecisions =
        await this.matchDecisionsRepository.findByConnection(connectionId);
      const previousCategorizedMatches = this.matchingService.findMatches(
        yourActiveList?.accounts ?? [],
        theirActiveList?.accounts ?? [],
        this.toDecisionOptions(
          previousDecisions,
          isCurrentUserSender,
          yourActiveList?.accounts ?? [],
          theirActiveList?.accounts ?? [],
        ),
      );
      previousResolvedCount = previousCategorizedMatches.resolved.length;
    }

    await this.matchDecisionsRepository.upsertDecision({
      connectionId,
      yourAccountId: canonicalPair.yourAccountId,
      theirAccountId: canonicalPair.theirAccountId,
      decision: dto.decision,
      yourNormalizedNameSnapshot: canonicalYourAccount?.normalizedName ?? null,
      theirNormalizedNameSnapshot:
        canonicalTheirAccount?.normalizedName ?? null,
    });

    if (dto.decision === 'accepted') {
      const decisions =
        await this.matchDecisionsRepository.findByConnection(connectionId);
      const decisionOptions = this.toDecisionOptions(
        decisions,
        isCurrentUserSender,
        yourActiveList?.accounts ?? [],
        theirActiveList?.accounts ?? [],
      );
      const categorizedMatches = this.matchingService.findMatches(
        yourActiveList?.accounts ?? [],
        theirActiveList?.accounts ?? [],
        decisionOptions,
      );
      if (
        connection.lastObservedSharedMatchCount === null &&
        previousResolvedCount !== null
      ) {
        await this.connectionsRepository.updateLastObservedSharedMatchCount(
          connection.id,
          previousResolvedCount,
        );
        connection.lastObservedSharedMatchCount = previousResolvedCount;
      }

      const mutedRecipientUserIdsAtDiscovery = new Set<string>();
      if (this.getMutedStateForUser(connection, connection.senderId).isMuted) {
        mutedRecipientUserIdsAtDiscovery.add(connection.senderId);
      }
      if (
        this.getMutedStateForUser(connection, connection.receiverId).isMuted
      ) {
        mutedRecipientUserIdsAtDiscovery.add(connection.receiverId);
      }

      await this.autoUnmuteEligibleUsers(
        connection,
        categorizedMatches.resolved.length,
      );
      const didIncreaseSharedMatches = await this.handleSharedMatchCountChange(
        connection,
        categorizedMatches.resolved.length,
      );
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
    }

    return { message: 'Match decision saved successfully' };
  }

  private logMatchStats(
    partnerName: string,
    connectionId: string,
    yourCount: number,
    theirCount: number,
    matches: CategorizedMatches,
  ): void {
    const resolved = matches.resolved;
    const suggested = matches.suggested;
    const totalMatches = resolved.length + suggested.length;

    const exactCount = resolved.filter((m) => m.matchType === 'exact').length;
    const autoCount = resolved.filter((m) => m.matchType === 'auto').length;
    const acceptedCount = resolved.filter(
      (m) => m.matchType === 'accepted',
    ).length;

    const totalResolved = resolved.length;
    const exactBehaviorCount = exactCount + autoCount;
    const exactBehaviorPercent =
      totalResolved > 0
        ? Math.round((exactBehaviorCount / totalResolved) * 100)
        : 0;

    this.logger.log(
      `[Match] partner=${partnerName} connection=${connectionId} ` +
        `your=${yourCount} their=${theirCount} ` +
        `resolved=${totalResolved} (exact=${exactCount} auto=${autoCount} accepted=${acceptedCount}) ` +
        `suggested=${suggested.length} total=${totalMatches} ` +
        `exactBehaviorDetection=${exactBehaviorPercent}%`,
    );
  }

  private async handleSharedMatchCountChange(
    connection: ConnectionWithUsersState,
    currentSharedCount: number,
  ): Promise<boolean> {
    const previousSharedCount = connection.lastObservedSharedMatchCount ?? null;

    if (previousSharedCount === null) {
      await this.connectionsRepository.updateLastObservedSharedMatchCount(
        connection.id,
        currentSharedCount,
      );
      connection.lastObservedSharedMatchCount = currentSharedCount;
      return currentSharedCount > 0;
    }

    if (currentSharedCount === previousSharedCount) return false;

    if (currentSharedCount < previousSharedCount) {
      const synced =
        await this.connectionsRepository.claimSharedMatchCountUpdate(
          connection.id,
          previousSharedCount,
          currentSharedCount,
        );

      if (!synced) return false;

      connection.lastObservedSharedMatchCount = currentSharedCount;
      return false;
    }

    const claimed =
      await this.connectionsRepository.claimSharedMatchCountUpdate(
        connection.id,
        previousSharedCount,
        currentSharedCount,
      );

    if (!claimed) {
      return false;
    }

    connection.lastObservedSharedMatchCount = currentSharedCount;
    return true;
  }

  private async autoUnmuteEligibleUsers(
    connection: ConnectionWithUsersState,
    currentSharedCount: number,
  ): Promise<boolean> {
    let nextConnectionState: ConnectionWithUsersState = connection;
    let hasMutation = false;

    for (const userId of [connection.senderId, connection.receiverId]) {
      const mutedState = this.getMutedStateForUser(nextConnectionState, userId);
      if (!mutedState.isMuted) {
        continue;
      }

      if (currentSharedCount <= mutedState.mutedMatchCount) {
        this.logger.log(
          `Auto-unmute skipped for connection ${connection.id} user ${userId}: currentSharedCount=${currentSharedCount}, mutedMatchCount=${mutedState.mutedMatchCount}`,
        );
        continue;
      }

      const updatedConnection =
        await this.connectionsRepository.clearMutedForUser(
          nextConnectionState,
          userId,
        );
      this.logger.log(
        `Auto-unmuted connection ${connection.id} for user ${userId}: currentSharedCount=${currentSharedCount}, mutedMatchCount=${mutedState.mutedMatchCount}`,
      );
      nextConnectionState = {
        ...nextConnectionState,
        ...updatedConnection,
      };
      hasMutation = true;
    }

    if (hasMutation) {
      Object.assign(connection, nextConnectionState);
    }

    return hasMutation;
  }

  private async sendNewOverlapNotifications(
    connection: ConnectionWithUsersState,
    context: ResolvedMatchNotificationContext,
    mutedRecipientUserIdsAtDiscovery: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    try {
      if (!context.resolvedMatches.length) {
        return;
      }

      const senderMuted = this.getMutedStateForUser(
        connection,
        connection.senderId,
      ).isMuted;
      const receiverMuted = this.getMutedStateForUser(
        connection,
        connection.receiverId,
      ).isMuted;

      const ctaUrl = `/dashboard/matches?connection=${connection.id}`;
      const recipients = [
        {
          userId: connection.sender.id,
          email: connection.sender.email,
          firstName: this.extractFirstName(connection.sender.name),
          connectionName: connection.receiver.name,
          muted: senderMuted,
          side: 'sender' as const,
        },
        {
          userId: connection.receiver.id,
          email: connection.receiver.email,
          firstName: this.extractFirstName(connection.receiver.name),
          connectionName: connection.sender.name,
          muted: receiverMuted,
          side: 'receiver' as const,
        },
      ].map((recipient) => ({
        ...recipient,
        mutedAtDiscovery: mutedRecipientUserIdsAtDiscovery.has(
          recipient.userId,
        ),
      }));

      const notificationCandidates = this.buildOverlapNotificationCandidates(
        connection,
        recipients,
        context,
      );
      if (!notificationCandidates.length) {
        return;
      }

      const newlyClaimed =
        await this.observedOverlapNotificationsRepository.claimNew(
          notificationCandidates.map((candidate) => ({
            userId: candidate.userId,
            connectionId: candidate.connectionId,
            senderNormalizedName: candidate.senderNormalizedName,
            receiverNormalizedName: candidate.receiverNormalizedName,
          })),
        );

      if (!newlyClaimed.length) {
        return;
      }

      const claimedKeys = new Set(
        newlyClaimed.map((claim) => this.toObservedOverlapClaimKey(claim)),
      );
      const newOverlapNotifications = notificationCandidates.filter(
        (candidate) =>
          claimedKeys.has(this.toObservedOverlapClaimKey(candidate)),
      );

      if (!newOverlapNotifications.length) {
        return;
      }

      const recipientsByUserId = new Map(
        recipients.map((recipient) => [recipient.userId, recipient]),
      );
      const deliverableNotifications = newOverlapNotifications.filter(
        (item) => {
          const recipient = recipientsByUserId.get(item.userId);
          if (!recipient) {
            return false;
          }

          return !recipient.muted && !recipient.mutedAtDiscovery;
        },
      );

      if (!deliverableNotifications.length) {
        return;
      }

      const recipientsWithNewNotifications = Array.from(
        new Set(deliverableNotifications.map((item) => item.userId)),
      )
        .map((userId) => recipientsByUserId.get(userId))
        .filter((recipient): recipient is OverlapNotificationRecipient =>
          Boolean(recipient),
        );

      await Promise.all(
        recipientsWithNewNotifications.map((recipient) =>
          this.emailService.sendNewOverlapsEmail(
            recipient.email,
            recipient.firstName,
            recipient.connectionName,
            `${process.env.FRONTEND_URL || 'http://localhost:3000'}${ctaUrl}`,
          ),
        ),
      );

      await this.notificationsService.createNewOverlapNotifications(
        deliverableNotifications.map((notification) => ({
          userId: notification.userId,
          connectionName: notification.connectionName,
          connectionId: notification.connectionId,
          accountName: notification.accountName,
          partnerAccountName: notification.partnerAccountName,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch new overlap notifications for connection ${connection.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
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
      yourAccountsById: new Map(
        params.yourAccounts.map((account) => [account.id, account]),
      ),
      theirAccountsById: new Map(
        params.theirAccounts.map((account) => [account.id, account]),
      ),
      isCurrentUserSender: params.isCurrentUserSender,
      acceptedDecisionSnapshotPairsByCurrentPairKey:
        params.acceptedDecisionSnapshotPairsByCurrentPairKey,
    };
  }

  private buildOverlapNotificationCandidates(
    connection: ConnectionWithUsersState,
    recipients: OverlapNotificationRecipient[],
    context: ResolvedMatchNotificationContext,
  ): OverlapNotificationCandidate[] {
    const candidates: OverlapNotificationCandidate[] = [];

    for (const match of context.resolvedMatches) {
      const yourAccount = context.yourAccountsById.get(match.yourAccountId);
      const theirAccount = context.theirAccountsById.get(match.theirAccountId);

      if (!yourAccount || !theirAccount) {
        continue;
      }

      const senderAccount = context.isCurrentUserSender
        ? yourAccount
        : theirAccount;
      const receiverAccount = context.isCurrentUserSender
        ? theirAccount
        : yourAccount;
      const acceptedSnapshotPair =
        match.matchType === 'accepted'
          ? context.acceptedDecisionSnapshotPairsByCurrentPairKey.get(
              this.toCurrentMatchPairKey(
                match.yourAccountId,
                match.theirAccountId,
              ),
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

  private toObservedOverlapClaimKey(
    claim: ObservedOverlapNotificationClaim,
  ): string {
    return `${claim.userId}::${claim.connectionId}::${claim.senderNormalizedName}::${claim.receiverNormalizedName}`;
  }

  private extractFirstName(fullName: string): string {
    const normalized = fullName.trim();
    if (!normalized) {
      return 'there';
    }

    return normalized.split(/\s+/)[0];
  }

  private getMutedStateForUser(
    connection: {
      senderId: string;
      receiverId?: string;
      senderMutedAt?: Date | null;
      senderMutedMatchCount?: number | null;
      receiverMutedAt?: Date | null;
      receiverMutedMatchCount?: number | null;
      lastObservedSharedMatchCount?: number | null;
    },
    userId: string,
  ) {
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
      const currentPair = this.resolveDecisionPairForCurrentAccounts(decision, {
        isCurrentUserSender,
        yourAccountIds,
        theirAccountIds,
        yourAccounts,
        theirAccounts,
        snapshotPair,
      });

      if (!currentPair) {
        continue;
      }

      if (decision.decision === 'accepted') {
        acceptedPairs.push(currentPair);
        const canonicalSnapshotPair = this.toCanonicalNormalizedNamePair(
          snapshotPair,
          currentPair,
          isCurrentUserSender,
          yourAccounts,
          theirAccounts,
        );
        if (canonicalSnapshotPair) {
          acceptedDecisionSnapshotPairsByCurrentPairKey.set(
            this.toCurrentMatchPairKey(
              currentPair.yourAccountId,
              currentPair.theirAccountId,
            ),
            canonicalSnapshotPair,
          );
        }
      } else {
        rejectedPairs.push(currentPair);
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
      ? (snapshotPair.yourNormalizedNameSnapshot ?? yourAccount?.normalizedName)
      : (snapshotPair.theirNormalizedNameSnapshot ??
        theirAccount?.normalizedName);
    const receiverNormalizedName = isCurrentUserSender
      ? (snapshotPair.theirNormalizedNameSnapshot ??
        theirAccount?.normalizedName)
      : (snapshotPair.yourNormalizedNameSnapshot ??
        yourAccount?.normalizedName);

    if (!senderNormalizedName || !receiverNormalizedName) {
      return null;
    }

    return {
      senderNormalizedName,
      receiverNormalizedName,
    };
  }

  private toCurrentMatchPairKey(
    yourAccountId: string,
    theirAccountId: string,
  ): string {
    return `${yourAccountId}::${theirAccountId}`;
  }

  private toCanonicalPair(
    connection: { senderId: string },
    currentUserId: string,
    yourAccountId: string,
    theirAccountId: string,
  ): MatchDecisionPair {
    if (connection.senderId === currentUserId) {
      return { yourAccountId, theirAccountId };
    }

    return {
      yourAccountId: theirAccountId,
      theirAccountId: yourAccountId,
    };
  }

  private isCurrentUserSender(
    connection: { senderId: string },
    userId: string,
  ): boolean {
    return connection.senderId === userId;
  }
}

interface ConnectionWithUsersState {
  id: string;
  status: string;
  senderId: string;
  receiverId: string;
  createdAt: Date;
  updatedAt: Date;
  senderMutedAt: Date | null;
  senderMutedMatchCount: number | null;
  receiverMutedAt: Date | null;
  receiverMutedMatchCount: number | null;
  lastObservedSharedMatchCount: number | null;
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

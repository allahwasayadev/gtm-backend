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
import type { MatchDecisionPair } from '../common/utils/account-matching.util';
import { SetMatchDecisionDto } from './dto';

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
  ) {}

  @Get('all-matches')
  async getAllMatches(@Request() req: { user: { id: string } }) {
    const userId = req.user.id;

    const activeList =
      await this.accountListsRepository.findFirstActive(userId);
    if (!activeList || !activeList.accounts.length) {
      return {};
    }

    const connections =
      await this.connectionsRepository.findAllAcceptedByUser(userId);
    if (!connections.length) {
      return {};
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
      );
      const categorizedMatches = this.matchingService.findMatches(
        activeList.accounts,
        theirActiveList.accounts,
        decisionOptions,
      );

      const resolvedCount = categorizedMatches.resolved.length;
      const hadAutoUnmute = await this.autoUnmuteEligibleUsers(
        connection,
        resolvedCount,
      );

      const mutedState = this.getMutedStateForUser(connection, userId);
      if (mutedState.isMuted) {
        return null;
      }

      const didSendNewOverlapNotification =
        await this.handleSharedMatchCountChange(connection, resolvedCount);
      if (hadAutoUnmute && !didSendNewOverlapNotification) {
        void this.sendNewOverlapNotifications(connection);
      }

      const partnerRelationshipType: PartnerRelationshipType =
        otherUser.isOemSeller ? 'OEM' : 'RESELLER';

      const allMatches = [
        ...categorizedMatches.resolved,
        ...categorizedMatches.suggested,
      ];

      return {
        partnerName: otherUser.name,
        partnerCompany: otherUser.company,
        partnerRelationshipType,
        resolvedMatches: allMatches,
      } as PartnerAccountData;
    });

    const partnerResults = await Promise.all(partnerDataPromises);
    const partners = partnerResults.filter(
      (partner): partner is PartnerAccountData => partner !== null,
    );

    return this.matchingService.buildResolvedAccountMatchesMap(partners);
  }

  @Get('connections/:connectionId')
  async getMatches(
    @Param('connectionId') connectionId: string,
    @Request() req: { user: { id: string } },
  ) {
    const userId = req.user.id;
    const connection = await this.connectionsRepository.findAcceptedConnection(
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

    return this.matchingService.findMatches(yourAccounts, theirAccounts, {
      ...this.toDecisionOptions(decisions, isCurrentUserSender),
    });
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

    let previousResolvedCount: number | null = null;
    if (dto.decision === 'accepted') {
      const previousDecisions =
        await this.matchDecisionsRepository.findByConnection(connectionId);
      const previousCategorizedMatches = this.matchingService.findMatches(
        yourActiveList?.accounts ?? [],
        theirActiveList?.accounts ?? [],
        this.toDecisionOptions(previousDecisions, isCurrentUserSender),
      );
      previousResolvedCount = previousCategorizedMatches.resolved.length;
    }

    await this.matchDecisionsRepository.upsertDecision({
      connectionId,
      yourAccountId: canonicalPair.yourAccountId,
      theirAccountId: canonicalPair.theirAccountId,
      decision: dto.decision,
    });

    if (dto.decision === 'accepted') {
      const decisions =
        await this.matchDecisionsRepository.findByConnection(connectionId);
      const decisionOptions = this.toDecisionOptions(
        decisions,
        isCurrentUserSender,
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

      const hadAutoUnmute = await this.autoUnmuteEligibleUsers(
        connection,
        categorizedMatches.resolved.length,
      );
      const didSendNewOverlapNotification =
        await this.handleSharedMatchCountChange(
          connection,
          categorizedMatches.resolved.length,
        );
      if (hadAutoUnmute && !didSendNewOverlapNotification) {
        void this.sendNewOverlapNotifications(connection);
      }
    }

    return { message: 'Match decision saved successfully' };
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
      return false;
    }

    if (currentSharedCount <= previousSharedCount) {
      return false;
    }

    const claimed = await this.connectionsRepository.claimSharedMatchIncrease(
      connection.id,
      previousSharedCount,
      currentSharedCount,
    );

    if (!claimed) {
      return false;
    }

    connection.lastObservedSharedMatchCount = currentSharedCount;
    void this.sendNewOverlapNotifications(connection);
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
  ): Promise<void> {
    try {
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
        },
        {
          userId: connection.receiver.id,
          email: connection.receiver.email,
          firstName: this.extractFirstName(connection.receiver.name),
          connectionName: connection.sender.name,
          muted: receiverMuted,
        },
      ].filter((recipient) => !recipient.muted);

      if (!recipients.length) {
        return;
      }

      await Promise.all(
        recipients.map((recipient) =>
          this.emailService.sendNewOverlapsEmail(
            recipient.email,
            recipient.firstName,
            recipient.connectionName,
            `${process.env.FRONTEND_URL || 'http://localhost:3000'}${ctaUrl}`,
          ),
        ),
      );

      await this.notificationsService.createNewOverlapNotifications(
        recipients.map((recipient) => ({
          userId: recipient.userId,
          connectionName: recipient.connectionName,
          connectionId: connection.id,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch new overlap notifications for connection ${connection.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
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
      decision: MatchDecisionType;
    }>,
    isCurrentUserSender: boolean,
  ): {
    acceptedPairs: MatchDecisionPair[];
    rejectedPairs: MatchDecisionPair[];
  } {
    const acceptedPairs: MatchDecisionPair[] = [];
    const rejectedPairs: MatchDecisionPair[] = [];

    for (const decision of decisions) {
      const pair: MatchDecisionPair = isCurrentUserSender
        ? {
            yourAccountId: decision.yourAccountId,
            theirAccountId: decision.theirAccountId,
          }
        : {
            yourAccountId: decision.theirAccountId,
            theirAccountId: decision.yourAccountId,
          };

      if (decision.decision === 'accepted') {
        acceptedPairs.push(pair);
      } else {
        rejectedPairs.push(pair);
      }
    }

    return { acceptedPairs, rejectedPairs };
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

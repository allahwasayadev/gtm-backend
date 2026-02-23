import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Account, Connection } from '@prisma/client';
import {
  ConnectionsRepository,
  type ConnectionWithUsers,
} from './connections.repository';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { AccountListsRepository } from '../account-lists/account-lists.repository';
import { findMatchedAccounts } from '../common/utils/account-matching.util';

@Injectable()
export class ConnectionsService {
  constructor(
    private connectionsRepository: ConnectionsRepository,
    private accountListsRepository: AccountListsRepository,
  ) {}

  async createConnection(
    senderId: string,
    createConnectionDto: CreateConnectionDto,
  ) {
    const receiver = await this.connectionsRepository.findUserByEmail(
      createConnectionDto.receiverEmail,
    );

    if (!receiver) {
      throw new NotFoundException('User not found with this email');
    }

    if (receiver.id === senderId) {
      throw new BadRequestException('Cannot connect with yourself');
    }

    const existingConnection =
      await this.connectionsRepository.findExistingConnection(
        senderId,
        receiver.id,
      );

    if (existingConnection) {
      throw new ConflictException('Connection already exists');
    }

    const connection = await this.connectionsRepository.create({
      senderId,
      receiverId: receiver.id,
      status: 'pending',
    });

    return connection;
  }

  async getConnections(userId: string, includeMuted = false) {
    const connections = await this.connectionsRepository.findAllByUser(userId);
    const accountsCache = new Map<string, Account[]>();

    await this.maybeClearMutedWhenCountIncreased(
      connections,
      userId,
      accountsCache,
    );

    const connectionResponses = await Promise.all(
      connections.map(async (connection) => {
        let sharedMatchCount = 0;
        if (connection.status === 'accepted') {
          const otherUserId = this.getOtherUserId(connection, userId);
          sharedMatchCount = await this.getSharedMatchCount( userId, otherUserId, accountsCache );
        }

        return this.toConnectionResponse(connection, userId, sharedMatchCount);
      }),
    );

    return connectionResponses
      .filter((c) => includeMuted || c.status !== 'accepted' || !c.isMuted);
  }

  async acceptConnection(connectionId: string, userId: string) {
    const connection = await this.connectionsRepository.findById(connectionId);

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.receiverId !== userId) {
      throw new BadRequestException(
        'Only the receiver can accept the connection',
      );
    }

    if (connection.status === 'accepted') {
      throw new ConflictException('Connection already accepted');
    }

    await this.connectionsRepository.updateStatus(connectionId, 'accepted');

    return { message: 'Connection accepted successfully' };
  }

  async deleteConnection(connectionId: string, userId: string) {
    await this.findConnectionForUser(connectionId, userId);
    await this.connectionsRepository.delete(connectionId);
    return { message: 'Connection deleted successfully' };
  }

  async muteConnection(connectionId: string, userId: string) {
    const connection = await this.findConnectionForUser(connectionId, userId);

    if (connection.status !== 'accepted') {
      throw new BadRequestException('Only accepted connections can be muted');
    }

    const mutedState = this.getMutedStateForUser(connection, userId);
    if (mutedState.isMuted) {
      return { message: 'Connection already muted' };
    }

    const otherUserId = this.getOtherUserId(connection, userId);
    const sharedMatchCount = await this.getSharedMatchCount(
      userId,
      otherUserId,
      new Map<string, Account[]>(),
    );

    await this.connectionsRepository.setMutedForUser(
      connection,
      userId,
      new Date(),
      sharedMatchCount,
    );

    const nextObservedSharedCount = Math.max(
      Number(connection.lastObservedSharedMatchCount ?? 0),
      sharedMatchCount,
    );
    await this.connectionsRepository.updateLastObservedSharedMatchCount(
      connection.id,
      nextObservedSharedCount,
    );

    return { message: 'Connection muted successfully' };
  }

  async unmuteConnection(connectionId: string, userId: string) {
    const connection = await this.findConnectionForUser(connectionId, userId);

    if (connection.status !== 'accepted') {
      throw new BadRequestException('Only accepted connections can be unmuted');
    }

    const mutedState = this.getMutedStateForUser(connection, userId);
    if (!mutedState.isMuted) {
      return { message: 'Connection is already unmuted' };
    }

    await this.connectionsRepository.clearMutedForUser(connection, userId);
    return { message: 'Connection unmuted successfully' };
  }

  private async findConnectionForUser(
    connectionId: string,
    userId: string,
  ): Promise<Connection> {
    const connection = await this.connectionsRepository.findById(connectionId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    if (connection.senderId !== userId && connection.receiverId !== userId) {
      throw new BadRequestException('You are not part of this connection');
    }
    return connection;
  }

  private getOtherUserId(connection: Connection, userId: string): string {
    return connection.senderId === userId
      ? connection.receiverId
      : connection.senderId;
  }

  private async maybeClearMutedWhenCountIncreased(
    connections: ConnectionWithUsers[],
    userId: string,
    accountsCache: Map<string, Account[]>,
  ): Promise<void> {
    await Promise.all(
      connections.map(async (connection) => {
        if (connection.status !== 'accepted') return;

        const mutedState = this.getMutedStateForUser(connection, userId);
        if (!mutedState.isMuted) return;

        const otherUserId = this.getOtherUserId(connection, userId);
        const currentSharedCount = await this.getSharedMatchCount(
          userId,
          otherUserId,
          accountsCache,
        );

        if (currentSharedCount > mutedState.mutedMatchCount) {
          const updated = await this.connectionsRepository.clearMutedForUser(
            connection,
            userId,
          );
          Object.assign(connection, updated);
        }
      }),
    );
  }

  private toConnectionResponse(
    connection: ConnectionWithUsers,
    userId: string,
    sharedMatchCount: number,
  ) {
    const mutedState = this.getMutedStateForUser(connection, userId);
    const isSender = connection.senderId === userId;
    return {
      ...connection,
      otherUser: isSender ? connection.receiver : connection.sender,
      isSender,
      isMuted: mutedState.isMuted,
      sharedMatchCount,
    };
  }

  private getMutedStateForUser(
    connection: Connection,
    userId: string,
  ): { isMuted: boolean; mutedMatchCount: number } {
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

  private async getSharedMatchCount(
    userId: string,
    otherUserId: string,
    accountsCache: Map<string, Account[]>,
  ): Promise<number> {
    const [yourAccounts, theirAccounts] = await Promise.all([
      this.getActiveAccounts(userId, accountsCache),
      this.getActiveAccounts(otherUserId, accountsCache),
    ]);

    const matches = findMatchedAccounts(yourAccounts, theirAccounts);
    return matches.resolved.length;
  }

  private async getActiveAccounts(
    userId: string,
    accountsCache: Map<string, Account[]>,
  ): Promise<Account[]> {
    const cached = accountsCache.get(userId);
    if (cached) {
      return cached;
    }

    const activeList =
      await this.accountListsRepository.findFirstActive(userId);
    const accounts = activeList?.accounts ?? [];
    accountsCache.set(userId, accounts);
    return accounts;
  }
}

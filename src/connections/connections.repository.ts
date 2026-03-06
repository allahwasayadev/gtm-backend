import { Injectable } from '@nestjs/common';
import { Connection, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ConnectionWithUsers extends Connection {
  sender: User;
  receiver: User;
}

@Injectable()
export class ConnectionsRepository {
  constructor(private prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findExistingConnection(
    senderId: string,
    receiverId: string,
  ): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });
  }

  async create(data: {
    senderId: string;
    receiverId: string;
    status: string;
  }): Promise<ConnectionWithUsers> {
    return this.prisma.connection.create({
      data,
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
      },
    }) as any;
  }

  async findAllByUser(userId: string): Promise<ConnectionWithUsers[]> {
    return this.prisma.connection.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findById(id: string): Promise<Connection | null> {
    return this.prisma.connection.findUnique({
      where: { id },
    });
  }

  async setMutedForUser(
    connection: Connection,
    userId: string,
    mutedAt: Date,
    mutedMatchCount: number,
  ): Promise<Connection> {
    const isSender = connection.senderId === userId;
    const data: Prisma.ConnectionUpdateInput = isSender
      ? {
          senderMutedAt: mutedAt,
          senderMutedMatchCount: mutedMatchCount,
        }
      : {
          receiverMutedAt: mutedAt,
          receiverMutedMatchCount: mutedMatchCount,
        };

    return this.prisma.connection.update({
      where: { id: connection.id },
      data,
    });
  }

  async clearMutedForUser(
    connection: Connection,
    userId: string,
  ): Promise<Connection> {
    const isSender = connection.senderId === userId;
    const data: Prisma.ConnectionUpdateInput = isSender
      ? {
          senderMutedAt: null,
          senderMutedMatchCount: null,
        }
      : {
          receiverMutedAt: null,
          receiverMutedMatchCount: null,
        };

    return this.prisma.connection.update({
      where: { id: connection.id },
      data,
    });
  }

  async updateLastObservedSharedMatchCount(
    connectionId: string,
    sharedMatchCount: number,
  ): Promise<void> {
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { lastObservedSharedMatchCount: sharedMatchCount },
    });
  }

  async resetLastObservedSharedMatchCountForUser(userId: string): Promise<number> {
    const result = await this.prisma.connection.updateMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      data: {
        lastObservedSharedMatchCount: 0,
      },
    });

    return result.count;
  }

  async claimSharedMatchIncrease( connectionId: string, previousSharedMatchCount: number | null, nextSharedMatchCount: number ): Promise<boolean> {
    return this.claimSharedMatchCountUpdate( connectionId, previousSharedMatchCount, nextSharedMatchCount );
  }
  async claimSharedMatchCountUpdate(
    connectionId: string,
    previousSharedMatchCount: number | null,
    nextSharedMatchCount: number,
  ): Promise<boolean> {
    const where: Prisma.ConnectionWhereInput = {
      id: connectionId,
      lastObservedSharedMatchCount: previousSharedMatchCount,
    };
    const result = await this.prisma.connection.updateMany({
      where,
      data: { lastObservedSharedMatchCount: nextSharedMatchCount },
    });

    return result.count === 1;
  }

  async updateStatus(id: string, status: string): Promise<Connection> {
    return this.prisma.connection.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string): Promise<Connection> {
    return this.prisma.connection.delete({
      where: { id },
    });
  }

  async findAllAcceptedByUser(userId: string): Promise<ConnectionWithUsers[]> {
    return this.prisma.connection.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'accepted',
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findAcceptedConnection(
    connectionId: string,
    userId: string,
  ): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'accepted',
      },
    });
  }

  async findAcceptedConnectionWithUsers(
    connectionId: string,
    userId: string,
  ): Promise<ConnectionWithUsers | null> {
    return this.prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'accepted',
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            roles: true,
          },
        },
      },
    }) as any;
  }

  async findAcceptedConnectionUserIds(userId: string): Promise<string[]> {
    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'accepted',
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      select: { senderId: true, receiverId: true },
    });

    const recipientIds = new Set<string>();
    for (const connection of connections) {
      recipientIds.add(
        connection.senderId === userId
          ? connection.receiverId
          : connection.senderId,
      );
    }

    return [...recipientIds];
  }
}

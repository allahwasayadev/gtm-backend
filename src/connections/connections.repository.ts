import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Connection, User } from '@prisma/client';

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
          },
        },
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
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
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
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
}

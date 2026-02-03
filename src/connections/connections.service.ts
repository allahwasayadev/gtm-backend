import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConnectionDto } from './dto/create-connection.dto';

@Injectable()
export class ConnectionsService {
  constructor(private prisma: PrismaService) {}

  async createConnection(senderId: string, createConnectionDto: CreateConnectionDto) {
    const receiver = await this.prisma.user.findUnique({
      where: { email: createConnectionDto.receiverEmail },
    });

    if (!receiver) {
      throw new NotFoundException('User not found with this email');
    }

    if (receiver.id === senderId) {
      throw new BadRequestException('Cannot connect with yourself');
    }

    const existingConnection = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
    });

    if (existingConnection) {
      throw new ConflictException('Connection already exists');
    }

    const connection = await this.prisma.connection.create({
      data: {
        senderId,
        receiverId: receiver.id,
        status: 'pending',
      },
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return connection;
  }

  async getConnections(userId: string) {
    const connections = await this.prisma.connection.findMany({
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
    });

    return connections.map((connection) => ({
      ...connection,
      otherUser:
        connection.senderId === userId ? connection.receiver : connection.sender,
      isSender: connection.senderId === userId,
    }));
  }

  async acceptConnection(connectionId: string, userId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.receiverId !== userId) {
      throw new BadRequestException('Only the receiver can accept the connection');
    }

    if (connection.status === 'accepted') {
      throw new ConflictException('Connection already accepted');
    }

    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: 'accepted' },
    });

    return { message: 'Connection accepted successfully' };
  }

  async deleteConnection(connectionId: string, userId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.senderId !== userId && connection.receiverId !== userId) {
      throw new BadRequestException('You are not part of this connection');
    }

    await this.prisma.connection.delete({
      where: { id: connectionId },
    });

    return { message: 'Connection deleted successfully' };
  }
}

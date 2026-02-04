import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConnectionsRepository } from './connections.repository';
import { CreateConnectionDto } from './dto/create-connection.dto';

@Injectable()
export class ConnectionsService {
  constructor(private connectionsRepository: ConnectionsRepository) {}

  async createConnection(senderId: string, createConnectionDto: CreateConnectionDto) {
    const receiver = await this.connectionsRepository.findUserByEmail(
      createConnectionDto.receiverEmail,
    );

    if (!receiver) {
      throw new NotFoundException('User not found with this email');
    }

    if (receiver.id === senderId) {
      throw new BadRequestException('Cannot connect with yourself');
    }

    const existingConnection = await this.connectionsRepository.findExistingConnection(
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

  async getConnections(userId: string) {
    const connections = await this.connectionsRepository.findAllByUser(userId);

    return connections.map((connection) => ({
      ...connection,
      otherUser:
        connection.senderId === userId ? connection.receiver : connection.sender,
      isSender: connection.senderId === userId,
    }));
  }

  async acceptConnection(connectionId: string, userId: string) {
    const connection = await this.connectionsRepository.findById(connectionId);

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.receiverId !== userId) {
      throw new BadRequestException('Only the receiver can accept the connection');
    }

    if (connection.status === 'accepted') {
      throw new ConflictException('Connection already accepted');
    }

    await this.connectionsRepository.updateStatus(connectionId, 'accepted');

    return { message: 'Connection accepted successfully' };
  }

  async deleteConnection(connectionId: string, userId: string) {
    const connection = await this.connectionsRepository.findById(connectionId);

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.senderId !== userId && connection.receiverId !== userId) {
      throw new BadRequestException('You are not part of this connection');
    }

    await this.connectionsRepository.delete(connectionId);

    return { message: 'Connection deleted successfully' };
  }
}

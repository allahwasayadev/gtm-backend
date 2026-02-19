import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ConnectionsRepository } from '../connections/connections.repository';
import { NotificationsService } from '../notifications/notifications.service';

export interface UpdatedProfileResponse {
  id: string;
  name: string;
  email: string;
  company: string | null;
  isOemSeller: boolean;
  createdAt: Date;
  token?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private usersRepository: UsersRepository,
    private jwtService: JwtService,
    private connectionsRepository: ConnectionsRepository,
    private notificationsService: NotificationsService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      isOemSeller: user.isOemSeller,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const shouldNotifyConnections = this.hasProfileChanges(user, dto);

    if (dto.email && dto.email !== user.email) {
      const existing = await this.usersRepository.findByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email already in use');
      }
    }

    const updated = await this.usersRepository.update(userId, dto);

    const result: UpdatedProfileResponse = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      company: updated.company,
      isOemSeller: updated.isOemSeller,
      createdAt: updated.createdAt,
    };

    if (dto.email && dto.email !== user.email) {
      result.token = this.jwtService.sign({
        sub: updated.id,
        email: updated.email,
      });
    }

    if (shouldNotifyConnections) {
      void this.notifyConnectionsAboutProfileUpdate(updated).catch((error) => {
        this.logger.error(
          `Failed to publish profile update notifications for user ${updated.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }

    return result;
  }

  private hasProfileChanges(user: User, dto: UpdateProfileDto): boolean {
    return (
      (typeof dto.name === 'string' && dto.name !== user.name) ||
      (typeof dto.email === 'string' && dto.email !== user.email) ||
      (typeof dto.company === 'string' &&
        dto.company !== (user.company ?? '')) ||
      (typeof dto.isOemSeller === 'boolean' &&
        dto.isOemSeller !== user.isOemSeller)
    );
  }

  private async notifyConnectionsAboutProfileUpdate(updatedUser: User) {
    const recipientUserIds =
      await this.connectionsRepository.findAcceptedConnectionUserIds(
        updatedUser.id,
      );
    if (!recipientUserIds.length) {
      return;
    }

    await this.notificationsService.createUserProfileUpdatedNotifications({
      actorUserName: updatedUser.name,
      actorUserId: updatedUser.id,
      recipientUserIds,
    });
  }
}

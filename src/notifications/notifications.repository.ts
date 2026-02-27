import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Notification } from '@prisma/client';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  ctaUrl?: string | null;
}

@Injectable()
export class NotificationsRepository {
  constructor(private prisma: PrismaService) {}

  async createManyAndReturn(data: CreateNotificationInput[]): Promise<Notification[]> {
    if (!data.length) return [];

    return this.prisma.$transaction(
      data.map((item) =>
        this.prisma.notification.create({
          data: {
            userId: item.userId,
            type: item.type,
            title: item.title,
            message: item.message,
            ctaUrl: item.ctaUrl ?? null,
          },
        }),
      ),
    );
  }

  async findByUser( userId: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number } ): Promise<Notification[]> {
    const take =
      typeof options?.limit === 'number'
        ? Math.max(1, Math.min(options.limit, 100))
        : undefined;
    const skip =
      typeof options?.offset === 'number'
        ? Math.max(0, Math.floor(options.offset))
        : undefined;
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(options?.unreadOnly && { readAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      ...(typeof skip === 'number' ? { skip } : {}),
      ...(typeof take === 'number' ? { take } : {}),
    });
  }

  async markAsRead(userId: string, notificationId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async countUnreadByUser(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }
}

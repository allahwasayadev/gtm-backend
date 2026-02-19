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

  async findByUser( userId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(options?.unreadOnly && { readAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
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
}

import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { NotificationsRepository, type CreateNotificationInput } from './notifications.repository';
import { NotificationsGateway, type RealtimeNotification } from './notifications.gateway';

export interface NotificationListItem {
  id: string;
  type: string;
  title: string;
  message: string;
  ctaUrl: string | null;
  isRead: boolean;
  createdAt: Date;
}

interface GetNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class NotificationsService {
  constructor(
    private notificationsRepository: NotificationsRepository,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async getMyNotifications(userId: string, options?: GetNotificationsOptions) {
    const notifications = await this.notificationsRepository.findByUser(
      userId,
      options,
    );
    return notifications.map((n) => this.toListItem(n));
  }

  async markAsRead(userId: string, notificationId: string) {
    const count = await this.notificationsRepository.markAsRead(
      userId,
      notificationId,
    );
    return { updated: count };
  }

  async markAllAsRead(userId: string) {
    const count = await this.notificationsRepository.markAllAsRead(userId);
    return { updated: count };
  }

  async getMyUnreadCount(userId: string) {
    const count = await this.notificationsRepository.countUnreadByUser(userId);
    return { count };
  }

  async createNewOverlapNotifications(
    payloads: Array<{
      userId: string;
      connectionName: string;
      connectionId: string;
      accountName?: string;
      partnerAccountName?: string;
    }>,
  ) {
    const data: CreateNotificationInput[] = payloads.map((p) => ({
      userId: p.userId,
      type: 'new_overlaps',
      title: p.accountName
        ? `New overlap: ${p.accountName}`
        : `New overlaps with ${p.connectionName}`,
      message: p.accountName
        ? this.buildNewOverlapAccountMessage(
            p.accountName,
            p.connectionName,
            p.partnerAccountName,
          )
        : `New shared accounts were identified between you and ${p.connectionName}.`,
      ctaUrl: `/dashboard/matches?connection=${p.connectionId}`,
    }));

    return this.createAndPublish(data);
  }

  private buildNewOverlapAccountMessage(
    accountName: string,
    connectionName: string,
    partnerAccountName?: string,
  ): string {
    if (!partnerAccountName || partnerAccountName === accountName) {
      return `"${accountName}" overlaps with ${connectionName}.`;
    }

    return `"${accountName}" overlaps with ${connectionName}'s "${partnerAccountName}".`;
  }

  async createUserProfileUpdatedNotifications(payload: { actorUserName: string, recipientUserIds: string[], actorUserId: string }) {
    if (!payload.recipientUserIds.length) return { count: 0 };

    const data: CreateNotificationInput[] = payload.recipientUserIds.map(
      (recipientUserId) => ({
        userId: recipientUserId,
        type: 'profile_updated',
        title: `${payload.actorUserName} updated their details`,
        message: `${payload.actorUserName} changed profile information that may affect your overlap visibility.`,
        ctaUrl: `/dashboard/connections?user=${payload.actorUserId}`,
      }),
    );

    return this.createAndPublish(data);
  }

  private toListItem(notification: Notification): NotificationListItem {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      ctaUrl: notification.ctaUrl,
      isRead: Boolean(notification.readAt),
      createdAt: notification.createdAt,
    };
  }

  private async createAndPublish(data: CreateNotificationInput[]) {
    const createdNotifications =
      await this.notificationsRepository.createManyAndReturn(data);

    for (const notification of createdNotifications) {
      const payload: RealtimeNotification = this.toListItem(notification);
      this.notificationsGateway.emitNotification(notification.userId, payload);
    }

    return { count: createdNotifications.length };
  }
}

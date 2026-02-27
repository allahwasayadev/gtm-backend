import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { NotificationListItem } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get('unread-count')
  async getMyUnreadCount(@Request() req: any): Promise<{ count: number }> {
    return this.notificationsService.getMyUnreadCount(req.user.id);
  }

  @Get()
  async getMyNotifications(
    @Request() req: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<NotificationListItem[]> {
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    return this.notificationsService.getMyNotifications(req.user.id, {
      unreadOnly: unreadOnly === 'true',
      limit:
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? parsedLimit
          : undefined,
      offset:
        Number.isFinite(parsedOffset) && parsedOffset >= 0
          ? parsedOffset
          : undefined,
    });
  }

  @Patch('read-all')
  async markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }
}

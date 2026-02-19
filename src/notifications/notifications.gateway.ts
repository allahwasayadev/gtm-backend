import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { corsOrigins } from '../common/cors.config';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import type { Server, Socket } from 'socket.io';

type RedisClient = ReturnType<typeof createClient>;
interface SocketData {
  userId?: string;
}

export interface RealtimeNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  ctaUrl: string | null;
  isRead: boolean;
  createdAt: Date;
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
  transports: ['websocket'],
  perMessageDeflate: false,
})
export class NotificationsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private redisPubClient: RedisClient | null = null;
  private redisSubClient: RedisClient | null = null;

  constructor(private jwtService: JwtService) {}

  afterInit(server: Server) {
    void this.configureRedisAdapter(server);
  }

  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (!payload?.sub) {
        client.disconnect(true);
        return;
      }

      const clientData = client.data as SocketData;
      clientData.userId = payload.sub;
      void client.join(this.getUserRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket, reason?: string): void {
    const clientData = client.data as SocketData;
    const userId =
      typeof clientData.userId === 'string' ? clientData.userId : 'unknown';
    this.logger.debug(
      `WebSocket disconnected for user ${userId} (reason: ${reason ?? 'unknown'})`,
    );
  }

  emitNotification(userId: string, notification: RealtimeNotification): void {
    if (!this.server) {
      return;
    }

    this.logger.debug(
      `Emitting notification ${notification.id} (${notification.type}) to user ${userId}`,
    );

    this.server.to(this.getUserRoom(userId)).emit('notifications.new', {
      ...notification,
      createdAt: notification.createdAt.toISOString(),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeRedisClients();
  }

  private async configureRedisAdapter(server: Server): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return;
    }

    try {
      this.redisPubClient = createClient({ url: redisUrl });
      this.redisSubClient = this.redisPubClient.duplicate();

      await Promise.all([
        this.redisPubClient.connect(),
        this.redisSubClient.connect(),
      ]);

      server.adapter(createAdapter(this.redisPubClient, this.redisSubClient));
      this.logger.log('Socket.IO Redis adapter enabled');
    } catch (error) {
      this.logger.error(
        'Failed to initialize Socket.IO Redis adapter',
        error instanceof Error ? error.stack : undefined,
      );
      await this.closeRedisClients();
    }
  }

  private async closeRedisClients(): Promise<void> {
    const closeClient = async (client: RedisClient | null): Promise<void> => {
      if (!client || !client.isOpen) {
        return;
      }

      try {
        await client.quit();
      } catch {
        // Ignore close failures; process shutdown continues.
      }
    };

    await Promise.all([
      closeClient(this.redisPubClient),
      closeClient(this.redisSubClient),
    ]);

    this.redisPubClient = null;
    this.redisSubClient = null;
  }

  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  private extractToken(client: Socket): string | null {
    const authPayload = client.handshake.auth as Record<string, unknown> | null;
    const authToken =
      typeof authPayload?.token === 'string' ? authPayload.token : null;
    if (authToken) {
      return this.stripBearerPrefix(authToken);
    }

    const headerValue = client.handshake.headers.authorization;
    if (typeof headerValue !== 'string') {
      return null;
    }

    return this.stripBearerPrefix(headerValue);
  }

  private stripBearerPrefix(tokenValue: string): string {
    return tokenValue.replace(/^Bearer\s+/i, '').trim();
  }
}

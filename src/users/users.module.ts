import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { ConnectionsModule } from '../connections/connections.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    ConnectionsModule,
    NotificationsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'ovrlap-secret-key-change-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, AdminAuthGuard],
  exports: [UsersRepository],
})
export class UsersModule {}

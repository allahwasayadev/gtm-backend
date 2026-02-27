import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccountListsModule } from './account-lists/account-lists.module';
import { ConnectionsModule } from './connections/connections.module';
import { MatchingModule } from './matching/matching.module';
import { UsersModule } from './users/users.module';
import { EmailModule } from './email/email.module';
import { InvitesModule } from './invites/invites.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SmsModule } from './sms/sms.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    SmsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AccountListsModule,
    ConnectionsModule,
    MatchingModule,
    InvitesModule,
    NotificationsModule,
  ],
})
export class AppModule {}

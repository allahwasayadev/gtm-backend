import { Module } from '@nestjs/common';
import { AccountListsController } from './account-lists.controller';
import { AccountListsService } from './account-lists.service';
import { AccountListsRepository } from './account-lists.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConnectionsRepository } from '../connections/connections.repository';
import { MatchingService } from '../matching/matching.service';
import { MatchDecisionsRepository } from '../matching/match-decisions.repository';
import { ObservedOverlapNotificationsRepository } from '../matching/observed-overlap-notifications.repository';
import { EmailService } from '../email/email.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [AccountListsController],
  providers: [AccountListsService, AccountListsRepository, ConnectionsRepository, MatchingService, MatchDecisionsRepository, ObservedOverlapNotificationsRepository, EmailService ],
  exports: [AccountListsService, AccountListsRepository],
})
export class AccountListsModule {}

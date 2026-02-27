import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { ConnectionsModule } from '../connections/connections.module';
import { AccountListsModule } from '../account-lists/account-lists.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchDecisionsRepository } from './match-decisions.repository';
import { ObservedOverlapNotificationsRepository } from './observed-overlap-notifications.repository';

@Module({
  imports: [ConnectionsModule, AccountListsModule, NotificationsModule],
  controllers: [MatchingController],
  providers: [
    MatchingService,
    MatchDecisionsRepository,
    ObservedOverlapNotificationsRepository,
  ],
})
export class MatchingModule {}

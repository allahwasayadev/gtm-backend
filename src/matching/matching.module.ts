import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { ConnectionsModule } from '../connections/connections.module';
import { AccountListsModule } from '../account-lists/account-lists.module';

@Module({
  imports: [ConnectionsModule, AccountListsModule],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}

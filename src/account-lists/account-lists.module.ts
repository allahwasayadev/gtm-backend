import { Module } from '@nestjs/common';
import { AccountListsController } from './account-lists.controller';
import { AccountListsService } from './account-lists.service';
import { AccountListsRepository } from './account-lists.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccountListsController],
  providers: [AccountListsService, AccountListsRepository],
  exports: [AccountListsService, AccountListsRepository],
})
export class AccountListsModule {}

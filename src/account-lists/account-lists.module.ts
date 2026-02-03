import { Module } from '@nestjs/common';
import { AccountListsController } from './account-lists.controller';
import { AccountListsService } from './account-lists.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccountListsController],
  providers: [AccountListsService],
  exports: [AccountListsService],
})
export class AccountListsModule {}

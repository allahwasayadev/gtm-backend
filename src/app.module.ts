import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccountListsModule } from './account-lists/account-lists.module';
import { ConnectionsModule } from './connections/connections.module';
import { MatchingModule } from './matching/matching.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    AccountListsModule,
    ConnectionsModule,
    MatchingModule,
  ],
})
export class AppModule {}

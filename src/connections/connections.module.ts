import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { ConnectionsRepository } from './connections.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ConnectionsRepository],
  exports: [ConnectionsService, ConnectionsRepository],
})
export class ConnectionsModule {}

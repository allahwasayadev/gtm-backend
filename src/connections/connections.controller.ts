import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateConnectionDto } from './dto/create-connection.dto';

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private connectionsService: ConnectionsService) {}

  @Post()
  async createConnection(
    @Body() createConnectionDto: CreateConnectionDto,
    @Request() req: any,
  ) {
    return this.connectionsService.createConnection(req.user.id, createConnectionDto);
  }

  @Get()
  async getConnections(@Request() req: any) {
    return this.connectionsService.getConnections(req.user.id);
  }

  @Post(':id/accept')
  async acceptConnection(@Param('id') id: string, @Request() req: any) {
    return this.connectionsService.acceptConnection(id, req.user.id);
  }

  @Delete(':id')
  async deleteConnection(@Param('id') id: string, @Request() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }
}

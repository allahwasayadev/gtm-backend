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
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateInviteDto } from './dto/create-invite.dto';

@Controller('invites')
export class InvitesController {
  constructor(private invitesService: InvitesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async sendInvite(@Body() dto: CreateInviteDto, @Request() req: any) {
    return this.invitesService.sendInvite(
      req.user.id,
      req.user.email,
      req.user.name,
      req.user.company || null,
      dto,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getMyInvites(@Request() req: any) {
    return this.invitesService.getMyInvites(req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async revokeInvite(@Param('id') id: string, @Request() req: any) {
    return this.invitesService.revokeInvite(id, req.user.id);
  }

  @Get('validate/:token')
  async validateToken(@Param('token') token: string) {
    return this.invitesService.validateToken(token);
  }

  @Post('accept/:token')
  @UseGuards(JwtAuthGuard)
  async acceptInvite(@Param('token') token: string, @Request() req: any) {
    return this.invitesService.acceptInvite(token, req.user.id, req.user.email);
  }
}

import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(private matchingService: MatchingService) {}

  @Get('connections/:connectionId')
  async getMatches(@Param('connectionId') connectionId: string, @Request() req: any) {
    return this.matchingService.getMatches(req.user.id, connectionId);
  }
}

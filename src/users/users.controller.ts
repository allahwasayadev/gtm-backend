import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CompleteOnboardingDto, SendPhoneVerificationCodeDto, UpdateProfileDto, VerifyPhoneVerificationCodeDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  async getProfile(@Request() req: any) {
    return this.usersService.getProfile(req.user.id);
  }

  @Patch('profile')
  async updateProfile(
    @Request() req: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.id, updateProfileDto);
  }

  @Post('profile/phone-verification/send')
  async sendPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: SendPhoneVerificationCodeDto,
  ) {
    return this.usersService.sendPhoneVerificationCode(req.user.id, dto);
  }

  @Post('profile/phone-verification/verify')
  async verifyPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: VerifyPhoneVerificationCodeDto,
  ) {
    return this.usersService.verifyPhoneVerificationCode(req.user.id, dto);
  }

  @Patch('onboarding/complete')
  async completeOnboarding(
    @Request() req: any,
    @Body() completeOnboardingDto: CompleteOnboardingDto,
  ) {
    return this.usersService.completeOnboarding(
      req.user.id,
      completeOnboardingDto,
    );
  }
}

import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CompleteOnboardingDto, SendPhoneVerificationCodeDto, UpdateProfileDto, VerifyPhoneVerificationCodeDto } from './dto';
import { JwtAuthGuard, SkipPhoneGate } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @UseGuards(AdminAuthGuard)
  async listUsers() {
    return this.usersService.listAllForAdmin();
  }

  @Get('stats')
  @UseGuards(AdminAuthGuard)
  async getAdminStats() {
    return this.usersService.getAdminStats();
  }

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

  /**
   * Send a verification code to the number on the profile.
   *
   * Authenticated, but outside the activation gate. Sending a code sets
   * isPhoneVerified back to false — the number being proved is not proved yet
   * — so under JwtAuthGuard the user's own next request would be rejected by
   * the gate this request exists to get them past. Same circularity, and same
   * remedy, as /auth/activation/from-session.
   *
   * Nothing else is relaxed: the caller is still authenticated, acts only on
   * their own account, and the send is still rate-limited and still refused
   * by assertMaySend without consent for THIS number.
   */
  @SkipPhoneGate()
  @Post('profile/phone-verification/send')
  async sendPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: SendPhoneVerificationCodeDto,
  ) {
    return this.usersService.sendPhoneVerificationCode(req.user.id, dto, {
      ipAddress:
        (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        null,
      userAgent: (req.headers?.['user-agent'] as string) ?? null,
    });
  }

  /**
   * Submit the code and become verified.
   *
   * Outside the gate for the same reason as the send above, and this is the
   * endpoint that proves it: the user is unverified precisely because they
   * asked for this code, so the activation gate made the step unreachable.
   *
   * Safe to leave outside the gate: it acts only on the caller's own account,
   * mints no session token, and still requires a stored, unexpired, hashed
   * code within the attempt limit.
   */
  @SkipPhoneGate()
  @Post('profile/phone-verification/verify')
  async verifyPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: VerifyPhoneVerificationCodeDto,
  ) {
    return this.usersService.verifyPhoneVerificationCode(req.user.id, dto);
  }

  /** Give SMS consent again from profile settings, for the number on file. */
  @Post('profile/sms-consent')
  async grantSmsConsent(@Request() req: any) {
    return this.usersService.grantSmsConsent(req.user.id, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
  }

  /** Withdraw SMS consent from profile settings. */
  @Post('profile/sms-consent/withdraw')
  async withdrawSmsConsent(@Request() req: any) {
    return this.usersService.withdrawSmsConsent(req.user.id);
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

  @Delete('profile')
  async deleteAccount(@Request() req: any) {
    return this.usersService.deleteAccount(req.user.id);
  }

  @Delete(':id')
  @UseGuards(AdminAuthGuard)
  async deleteUser(@Request() req: any, @Param('id') id: string) {
    return this.usersService.deleteUserAsAdmin(req.user.id, id);
  }
}

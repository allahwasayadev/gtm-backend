import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifySignupPhoneDto,
  ResendSignupPhoneDto,
} from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SendPhoneVerificationCodeDto, VerifyPhoneVerificationCodeDto } from '../users/dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  async signup(@Body() signupDto: SignupDto, @Request() req: any) {
    // Captured alongside the consent record so it can be produced on request.
    return this.authService.signup(signupDto, {
      ipAddress:
        (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        null,
      userAgent: (req.headers?.['user-agent'] as string) ?? null,
    });
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  // Activation is by SMS only. The former verify-email / resend-verification
  // endpoints are gone: an email code or link is no longer part of any flow,
  // so leaving them reachable would contradict that.
  @Post('phone/verify')
  async verifySignupPhone(@Body() dto: VerifySignupPhoneDto) {
    return this.authService.verifySignupPhone(dto.email, dto.code);
  }

  @Post('phone/resend')
  async resendSignupPhone(@Body() dto: ResendSignupPhoneDto) {
    return this.authService.resendSignupPhoneCode(dto.email);
  }

  // Phone Verification Endpoints (used during signup flow)
  @UseGuards(JwtAuthGuard)
  @Post('phone-verification/send')
  async sendPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: SendPhoneVerificationCodeDto,
  ) {
    return this.authService.sendPhoneVerificationCode(req.user.id, dto.phoneNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Post('phone-verification/verify')
  async verifyPhoneVerificationCode(
    @Request() req: any,
    @Body() dto: VerifyPhoneVerificationCodeDto,
  ) {
    return this.authService.verifyPhoneCode(req.user.id, dto.code);
  }

  // Password Reset Endpoints
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.identifier);
  }

  // verify-reset-token is gone with the emailed link: there is no token to
  // pre-validate, and probing one would be an enumeration vector anyway.

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(
      dto.identifier,
      dto.code,
      dto.newPassword,
    );
  }
}

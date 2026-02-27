import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { SignupDto, LoginDto } from './dto';

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_PASSWORD_RESET_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private authRepository: AuthRepository,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async signup(signupDto: SignupDto) {
    const existingUser = await this.authRepository.findUserByEmail(
      signupDto.email,
    );

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(signupDto.password, 10);

    const user = await this.authRepository.createUser({
      name: signupDto.name,
      email: signupDto.email,
      passwordHash: passwordHash,
      isOemSeller: signupDto.isOemSeller,
      ...(signupDto.company && { company: signupDto.company }),
    });

    // Initiate email verification
    await this.initiateEmailVerification(user.id, user.email, user.name);

    const token = this.generateToken(user.id, user.email);

    return {
      user: this.buildAuthUserResponse(user),
      token,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.authRepository.findUserByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.generateToken(user.id, user.email);

    return {
      user: this.buildAuthUserResponse(user),
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.buildAuthUserResponse(user);
  }

  // Email Verification Methods
  async initiateEmailVerification(
    userId: string,
    email: string,
    userName: string,
  ): Promise<void> {
    const code = this.generateVerificationCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(
      Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.authRepository.updateEmailVerification(userId, {
      emailVerificationCode: codeHash,
      emailVerificationCodeExpiresAt: expiresAt,
      emailVerificationAttempts: 0,
      lastVerificationCodeSentAt: new Date(),
    });

    await this.emailService.sendVerificationEmail(email, userName, code);
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.authRepository.findUserByEmail(email);

    if (!user) {
      throw new BadRequestException('Invalid verification request');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    if (!user.emailVerificationCode || !user.emailVerificationCodeExpiresAt) {
      throw new BadRequestException(
        'No verification code found. Please request a new one.',
      );
    }

    if (user.emailVerificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (new Date() > user.emailVerificationCodeExpiresAt) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new one.',
      );
    }

    const codeHash = this.hashCode(code);
    const isCodeValid = crypto.timingSafeEqual(
      Buffer.from(codeHash),
      Buffer.from(user.emailVerificationCode),
    );

    if (!isCodeValid) {
      await this.authRepository.incrementVerificationAttempts(user.id);
      const remainingAttempts =
        MAX_VERIFICATION_ATTEMPTS - user.emailVerificationAttempts - 1;
      throw new BadRequestException(
        `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
      );
    }

    await this.authRepository.setEmailVerified(user.id);

    const token = this.generateToken(user.id, user.email);

    return {
      user: this.buildAuthUserResponse(user, { emailVerified: true }),
      token,
    };
  }

  async resendVerificationCode(email: string) {
    const user = await this.authRepository.findUserByEmail(email);

    if (!user) {
      // Don't reveal if email exists
      return { message: 'If the email exists, a new code has been sent.' };
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Check cooldown
    if (user.lastVerificationCodeSentAt) {
      const timeSinceLastSent =
        (Date.now() - user.lastVerificationCodeSentAt.getTime()) / 1000;
      if (timeSinceLastSent < RESEND_COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(RESEND_COOLDOWN_SECONDS - timeSinceLastSent);
        throw new HttpException(
          `Please wait ${waitTime} seconds before requesting a new code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.initiateEmailVerification(user.id, user.email, user.name);

    return { message: 'A new verification code has been sent to your email.' };
  }

  // Password Reset Methods
  async requestPasswordReset(email: string) {
    const user = await this.authRepository.findUserByEmail(email);

    // Always return success to prevent email enumeration
    const successMessage =
      'If an account exists with this email, a password reset link has been sent.';

    if (!user) {
      return { message: successMessage };
    }

    // Check cooldown
    if (user.lastPasswordResetRequestAt) {
      const timeSinceLastRequest =
        (Date.now() - user.lastPasswordResetRequestAt.getTime()) / 1000;
      if (timeSinceLastRequest < RESEND_COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(
          RESEND_COOLDOWN_SECONDS - timeSinceLastRequest,
        );
        throw new HttpException(
          `Please wait ${waitTime} seconds before requesting another reset.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const token = this.generateResetToken();
    const tokenHash = this.hashCode(token);
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    await this.authRepository.updatePasswordReset(user.id, {
      passwordResetToken: tokenHash,
      passwordResetTokenExpiresAt: expiresAt,
      passwordResetAttempts: 0,
      lastPasswordResetRequestAt: new Date(),
    });

    await this.emailService.sendPasswordResetEmail(user.email, user.name, token);

    return { message: successMessage };
  }

  async validateResetToken(token: string) {
    const tokenHash = this.hashCode(token);
    const user =
      await this.authRepository.findUserByPasswordResetToken(tokenHash);

    if (!user) {
      return { valid: false };
    }

    return { valid: true, email: user.email };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashCode(token);
    const user =
      await this.authRepository.findUserByPasswordResetToken(tokenHash);

    if (!user) {
      throw new BadRequestException(
        'Invalid or expired reset link. Please request a new one.',
      );
    }

    if (user.passwordResetAttempts >= MAX_PASSWORD_RESET_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Please request a new reset link.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.authRepository.updatePassword(user.id, passwordHash);
    if (!user.emailVerified) {
      await this.authRepository.setEmailVerified(user.id);
    }

    return { message: 'Your password has been reset successfully.' };
  }

  // Helper Methods
  private generateToken(userId: string, email: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
    });
  }

  private generateVerificationCode(): string {
    // Generate a 6-digit code
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private buildAuthUserResponse(
    user: any,
    overrides?: { emailVerified?: boolean },
  ) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      isOemSeller: user.isOemSeller,
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      emailVerified: overrides?.emailVerified ?? user.emailVerified,
      phoneNumber: user.phoneNumber ?? null,
      isPhoneVerified: Boolean(user.isPhoneVerified),
      createdAt: user.createdAt,
    };
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}

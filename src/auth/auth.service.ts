import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';
import { SmsConsentService } from '../sms/sms-consent.service';
import { SmsConsentSource } from '../sms/sms-consent.constants';
import { testCodeFor } from '../sms/sms-test-mode';
import { SignupDto, LoginDto } from './dto';

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_PASSWORD_RESET_ATTEMPTS = 5;

// Phone verification constants
const PHONE_CODE_EXPIRY_MINUTES = 10;
const PHONE_RESEND_COOLDOWN_SECONDS = 60;
const MAX_PHONE_VERIFICATION_ATTEMPTS = 5;
const MAX_PHONE_SENDS_PER_HOUR = 5;
const PHONE_SEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private authRepository: AuthRepository,
    private jwtService: JwtService,
    private emailService: EmailService,
    private twilioSmsService: TwilioSmsService,
    private smsConsentService: SmsConsentService,
  ) {}

  async signup(
    signupDto: SignupDto,
    requestContext?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const existingUser = await this.authRepository.findUserByEmail(
      signupDto.email,
    );

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hasAdminRole = signupDto.roles?.some((r) => r === 'Admin');
    if (hasAdminRole) {
      throw new BadRequestException(
        'Admin role cannot be self-assigned; it is assigned separately.',
      );
    }

    const phoneNumber = this.normalizePhoneNumber(signupDto.phoneNumber);
    if (!phoneNumber) {
      throw new BadRequestException(
        'Enter a valid mobile number, including the country code.',
      );
    }

    // One account per number: otherwise two accounts could race for codes on
    // the same handset, and reset-by-phone would be ambiguous.
    const phoneOwner =
      await this.authRepository.findUserByPhoneNumber(phoneNumber);
    if (phoneOwner) {
      throw new ConflictException('Mobile number already in use');
    }

    const passwordHash = await bcrypt.hash(signupDto.password, 10);

    const user = await this.authRepository.createUser({
      name: signupDto.name,
      email: signupDto.email,
      passwordHash: passwordHash,
      roles: signupDto.roles,
      ...(signupDto.company && { company: signupDto.company }),
      phoneNumber,
    });

    // The compliance record. Written before anything is sent, never after.
    await this.smsConsentService.recordConsent(user.id, phoneNumber, {
      source: SmsConsentSource.SignupForm,
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    });

    // SMS is the only activation channel. No session token is issued here:
    // the account is not usable until the code is entered.
    let smsSent = true;
    let expiresAt: Date | null = null;
    try {
      const sent = await this.sendPhoneVerificationCode(user.id, phoneNumber);
      expiresAt = (sent as { expiresAt?: Date }).expiresAt ?? null;
    } catch (err) {
      // The account exists and the number is on file, so resend can recover it.
      // Never claim delivery that did not happen.
      smsSent = false;
      this.logger.error(
        `Signup verification SMS failed for user ${user.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      pendingVerification: true,
      email: user.email,
      phoneHint: this.maskPhoneNumber(phoneNumber),
      smsSent,
      expiresAt,
    };
  }

  /** "+14843231498" -> "+1 •••• ••1498". Enough to recognise, not to read. */
  private maskPhoneNumber(phoneNumber: string): string {
    const last4 = phoneNumber.slice(-4);
    return `${phoneNumber.slice(0, 2)} •••• ••${last4}`;
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

    // The account is not usable until the phone is verified. Raised only after
    // the password has been checked, so it tells an attacker nothing they
    // could not already determine.
    if (!(user as { isPhoneVerified?: boolean }).isPhoneVerified) {
      throw new HttpException(
        {
          message:
            'Verify your mobile number to finish setting up your account.',
          code: 'PHONE_VERIFICATION_REQUIRED',
          email: user.email,
          phoneHint: (user as { phoneNumber?: string }).phoneNumber
            ? this.maskPhoneNumber(
                (user as { phoneNumber: string }).phoneNumber,
              )
            : null,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const token = this.generateToken(user.id, user.email);

    return {
      user: this.buildAuthUserResponse(user),
      token,
    };
  }

  /**
   * Activation verify — unauthenticated, because signup issues no token.
   * Keyed by the email just used to sign up plus the code from the handset.
   */
  async verifySignupPhone(email: string, code: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      // Same shape as a wrong code: do not confirm which part was wrong.
      throw new BadRequestException('Invalid or expired code.');
    }

    const result = await this.verifyPhoneCode(user.id, code.trim());

    // Verifying the phone is what activates the account, so the session token
    // is issued here rather than at signup.
    return result;
  }

  /** Activation resend — unauthenticated, same limits as any other send. */
  async resendSignupPhoneCode(email: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      throw new BadRequestException('Invalid or expired code.');
    }

    const phoneNumber = (user as { phoneNumber?: string }).phoneNumber;
    if (!phoneNumber) {
      throw new BadRequestException('No mobile number on file for this account.');
    }

    if ((user as { isPhoneVerified?: boolean }).isPhoneVerified) {
      throw new BadRequestException('This number is already verified.');
    }

    return this.sendPhoneVerificationCode(user.id, phoneNumber);
  }

  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.buildAuthUserResponse(user);
  }

  // Email Verification Methods
  // Email verification has been removed entirely. Activation is by SMS to a
  // required, verified mobile number; there is no email code or link in any
  // flow, so initiateEmailVerification / verifyEmail / resendVerificationCode
  // and their endpoints are gone rather than left reachable.

  async sendPhoneVerificationCode(userId: string, phoneNumber: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const normalized = this.normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      throw new BadRequestException('Phone number is required');
    }

    // Already verified with this number
    if ((user as any).isPhoneVerified && (user as any).phoneNumber === normalized) {
      return {
        message: 'Phone number is already verified.',
        phoneNumber: normalized,
        isPhoneVerified: true,
      };
    }

    // Resend cooldown
    const lastSent = (user as any).lastPhoneVerificationCodeSentAt;
    if (lastSent) {
      const elapsed = (Date.now() - new Date(lastSent).getTime()) / 1000;
      if (elapsed < PHONE_RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(PHONE_RESEND_COOLDOWN_SECONDS - elapsed);
        throw new HttpException(
          `Please wait ${wait} seconds before requesting a new code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Hourly send limit
    const sendCount = (user as any).phoneVerificationSendCount ?? 0;
    const windowStart = (user as any).phoneVerificationSendWindowStart;
    const windowExpired = !windowStart || Date.now() - new Date(windowStart).getTime() > PHONE_SEND_WINDOW_MS;

    if (!windowExpired && sendCount >= MAX_PHONE_SENDS_PER_HOUR) {
      throw new HttpException(
        'Too many verification codes requested. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Consent gate. Nothing is sent to a number that has not opted in, or
    // that has since replied STOP.
    await this.smsConsentService.assertMaySend(userId, normalized);

    const code = testCodeFor(normalized) ?? this.generateVerificationCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + PHONE_CODE_EXPIRY_MINUTES * 60 * 1000);

    await this.twilioSmsService.sendVerificationCode(normalized, code);

    await this.authRepository.updatePhoneVerification(userId, {
      phoneNumber: normalized,
      isPhoneVerified: false,
      phoneVerificationCode: codeHash,
      phoneVerificationCodeExpiresAt: expiresAt,
      phoneVerificationAttempts: 0,
      lastPhoneVerificationCodeSentAt: new Date(),
      phoneVerificationSendCount: windowExpired ? 1 : sendCount + 1,
      phoneVerificationSendWindowStart: windowExpired ? new Date() : undefined,
    });

    const response: any = {
      message: 'Verification code sent via SMS.',
      phoneNumber: normalized,
      isPhoneVerified: false,
      expiresAt,
    };
    if (
      process.env.LOG_PHONE_VERIFICATION_CODE === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      response.code = code;
    }
    return response;
  }


  /**
   * Password reset request.
   *
   * Accepts an email address OR a mobile number. The code is sent only by SMS,
   * and only to a number the account has already VERIFIED — so a reset can
   * never be delivered to a number the owner has not proved they control.
   *
   * Every exit path returns the SAME neutral message: unknown identifier, no
   * verified phone, opted out via STOP, rate-limited, or Twilio failing. Any
   * observable difference would disclose whether the account exists.
   */
  async requestPasswordReset(identifier: string) {
    const neutralMessage =
      'If an account exists with a verified mobile number, a reset code has been sent to it.';

    const user = await this.findUserByIdentifier(identifier);
    if (!user) {
      return { message: neutralMessage };
    }

    const phoneNumber = (user as { phoneNumber?: string }).phoneNumber;
    const isPhoneVerified = (user as { isPhoneVerified?: boolean })
      .isPhoneVerified;

    // No verified phone means no delivery channel. Silent on purpose.
    if (!phoneNumber || !isPhoneVerified) {
      this.logger.warn(
        `Password reset requested for user ${user.id} with no verified phone; suppressed.`,
      );
      return { message: neutralMessage };
    }

    if (user.lastPasswordResetRequestAt) {
      const elapsed =
        (Date.now() - user.lastPasswordResetRequestAt.getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        this.logger.warn(
          `Password reset re-requested within cooldown for user ${user.id}; suppressed.`,
        );
        return { message: neutralMessage };
      }
    }

    // Consent and opt-out gate this send exactly as they gate any other. A
    // number that replied STOP is blocked here, never bypassed.
    try {
      await this.smsConsentService.assertMaySend(user.id, phoneNumber);
    } catch {
      this.logger.warn(
        `Password reset blocked by consent/opt-out state for user ${user.id}.`,
      );
      return { message: neutralMessage };
    }

    const code = this.generateVerificationCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(
      Date.now() + PHONE_CODE_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.authRepository.updatePasswordReset(user.id, {
      // Field name is historical; it now holds a hashed 6-digit code.
      passwordResetToken: codeHash,
      passwordResetTokenExpiresAt: expiresAt,
      passwordResetAttempts: 0,
      lastPasswordResetRequestAt: new Date(),
    });

    try {
      await this.twilioSmsService.sendPasswordResetCode(phoneNumber, code);
    } catch (err) {
      // Not surfaced: reporting the failure would confirm the account exists.
      this.logger.error(
        `Password reset SMS failed for user ${user.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { message: neutralMessage };
  }

  /** Resolve an email address or a mobile number to one account. */
  private async findUserByIdentifier(identifier: string) {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) {
      return this.authRepository.findUserByEmail(trimmed.toLowerCase());
    }
    const normalized = this.normalizePhoneNumber(trimmed);
    if (!normalized) return null;
    return this.authRepository.findUserByPhoneNumber(normalized);
  }

  async resetPassword(identifier: string, code: string, newPassword: string) {
    const generic = 'Invalid or expired code. Please request a new one.';

    const user = await this.findUserByIdentifier(identifier);
    if (
      !user ||
      !user.passwordResetToken ||
      !user.passwordResetTokenExpiresAt
    ) {
      throw new BadRequestException(generic);
    }

    if (user.passwordResetAttempts >= MAX_PASSWORD_RESET_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (new Date() > user.passwordResetTokenExpiresAt) {
      throw new BadRequestException(generic);
    }

    const codeHash = this.hashCode(code.trim());
    const stored = user.passwordResetToken;
    const valid =
      codeHash.length === stored.length &&
      crypto.timingSafeEqual(Buffer.from(codeHash), Buffer.from(stored));

    if (!valid) {
      await this.authRepository.incrementPasswordResetAttempts(user.id);
      throw new BadRequestException(generic);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.authRepository.updatePassword(user.id, passwordHash);

    // Burn the code so it cannot be replayed.
    await this.authRepository.updatePasswordReset(user.id, {
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      passwordResetAttempts: 0,
    });

    return { message: 'Your password has been reset successfully.' };
  }

  async verifyPhoneCode(userId: string, code: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!(user as any).phoneNumber) {
      throw new BadRequestException('No phone number on file. Please send a verification code first.');
    }

    if ((user as any).isPhoneVerified) {
      const token = this.generateToken(user.id, user.email);
      return {
        user: this.buildAuthUserResponse(user, { isPhoneVerified: true }),
        token,
      };
    }

    if (!(user as any).phoneVerificationCode || !(user as any).phoneVerificationCodeExpiresAt) {
      throw new BadRequestException('No verification code found. Please request a new one.');
    }

    if (((user as any).phoneVerificationAttempts ?? 0) >= MAX_PHONE_VERIFICATION_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (new Date() > (user as any).phoneVerificationCodeExpiresAt) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    const codeHash = this.hashCode(code.trim());
    const isCodeValid = crypto.timingSafeEqual(
      Buffer.from(codeHash),
      Buffer.from((user as any).phoneVerificationCode),
    );

    if (!isCodeValid) {
      await this.authRepository.incrementPhoneVerificationAttempts(userId);
      const remaining = MAX_PHONE_VERIFICATION_ATTEMPTS - ((user as any).phoneVerificationAttempts ?? 0) - 1;
      throw new BadRequestException(
        `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      );
    }

    await this.authRepository.setPhoneVerified(userId);

    const token = this.generateToken(user.id, user.email);
    return {
      user: this.buildAuthUserResponse(user, { isPhoneVerified: true }),
      token,
    };
  }

  private normalizePhoneNumber(phoneNumber: string): string | null {
    const trimmed = phoneNumber.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException('Phone number must be in E.164 format (example: +15551234567).');
    }
    return normalized;
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
    overrides?: { emailVerified?: boolean; isPhoneVerified?: boolean },
  ) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      roles: user.roles ?? [],
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      emailVerified: overrides?.emailVerified ?? user.emailVerified,
      phoneNumber: user.phoneNumber ?? null,
      isPhoneVerified: overrides?.isPhoneVerified ?? Boolean(user.isPhoneVerified),
      smsConsent: Boolean(user.smsConsent),
      smsConsentAt: user.smsConsentAt ?? null,
      smsOptedOut: Boolean(user.smsOptedOut),
      createdAt: user.createdAt,
    };
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}

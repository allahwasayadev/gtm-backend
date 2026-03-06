import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { User, UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { UsersRepository } from './users.repository';
import {
  CompleteOnboardingDto,
  SendPhoneVerificationCodeDto,
  UpdateProfileDto,
  VerifyPhoneVerificationCodeDto,
} from './dto';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsRepository } from '../connections/connections.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { TwilioSmsService } from '../sms/twilio-sms.service';

const PHONE_VERIFICATION_CODE_EXPIRY_MINUTES = 10;
const PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
const MAX_PHONE_VERIFICATION_ATTEMPTS = 5;

type UserWithPhoneVerification = User & {
  phoneNumber?: string | null;
  isPhoneVerified?: boolean;
  phoneVerificationCode?: string | null;
  phoneVerificationCodeExpiresAt?: Date | null;
  phoneVerificationAttempts?: number;
  lastPhoneVerificationCodeSentAt?: Date | null;
};

export interface UpdatedProfileResponse {
  id: string;
  name: string;
  email: string;
  company: string | null;
  roles: UserRole[];
  hasCompletedOnboarding: boolean;
  phoneNumber: string | null;
  isPhoneVerified: boolean;
  createdAt: Date;
  token?: string;
}

export interface SendPhoneVerificationCodeResponse {
  message: string;
  phoneNumber: string;
  isPhoneVerified: boolean;
  expiresAt?: Date;
}

export interface VerifyPhoneVerificationCodeResponse {
  message: string;
  phoneNumber: string;
  isPhoneVerified: boolean;
}

export interface CompleteOnboardingResponse {
  message: string;
  hasCompletedOnboarding: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private usersRepository: UsersRepository,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private connectionsRepository: ConnectionsRepository,
    private notificationsService: NotificationsService,
    private twilioSmsService: TwilioSmsService,
  ) {}

  async getProfile(userId: string) {
    const user = (await this.usersRepository.findById(
      userId,
    )) as UserWithPhoneVerification | null;
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      company: user.company,
      roles: user.roles ?? [],
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      phoneNumber: user.phoneNumber,
      isPhoneVerified: Boolean(user.isPhoneVerified),
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = (await this.usersRepository.findById(
      userId,
    )) as UserWithPhoneVerification | null;
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const normalizedPhoneNumber =
      typeof dto.phoneNumber === 'string'
        ? this.normalizePhoneNumber(dto.phoneNumber)
        : undefined;
    const currentPhoneNumber = user.phoneNumber ?? null;
    const isPhoneNumberChanging =
      typeof normalizedPhoneNumber !== 'undefined' &&
      normalizedPhoneNumber !== currentPhoneNumber;

    const shouldNotifyConnections = this.hasProfileChanges(user, dto);

    if (dto.email && dto.email !== user.email) {
      if (!user.isPhoneVerified || isPhoneNumberChanging) {
        throw new BadRequestException(
          'Please verify your phone number before updating your email.',
        );
      }
    }

    if (dto.email && dto.email !== user.email) {
      const existing = await this.usersRepository.findByEmail(dto.email);
      if (existing && existing.id !== user.id) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: any = {
      ...(typeof dto.name === 'string' ? { name: dto.name } : {}),
      ...(typeof dto.email === 'string' ? { email: dto.email } : {}),
      ...(typeof dto.company === 'string' ? { company: dto.company } : {}),
      ...(Array.isArray(dto.roles) ? { roles: dto.roles } : {}),
    };

    if (typeof normalizedPhoneNumber !== 'undefined' && isPhoneNumberChanging) {
      updateData.phoneNumber = normalizedPhoneNumber;
      updateData.isPhoneVerified = false;
      updateData.phoneVerificationCode = null;
      updateData.phoneVerificationCodeExpiresAt = null;
      updateData.phoneVerificationAttempts = 0;
      updateData.lastPhoneVerificationCodeSentAt = null;
    }

    const updated = (await this.usersRepository.update(
      userId,
      updateData,
    )) as UserWithPhoneVerification;

    const result: UpdatedProfileResponse = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      company: updated.company,
      roles: updated.roles ?? [],
      hasCompletedOnboarding: updated.hasCompletedOnboarding,
      phoneNumber: updated.phoneNumber ?? null,
      isPhoneVerified: Boolean(updated.isPhoneVerified),
      createdAt: updated.createdAt,
    };

    if (dto.email && dto.email !== user.email) {
      result.token = this.jwtService.sign({
        sub: updated.id,
        email: updated.email,
      });
    }

    if (shouldNotifyConnections) {
      void this.notifyConnectionsAboutProfileUpdate(updated).catch((error) => {
        this.logger.error(
          `Failed to publish profile update notifications for user ${updated.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }

    return result;
  }

  async sendPhoneVerificationCode(
    userId: string,
    dto: SendPhoneVerificationCodeDto,
  ): Promise<SendPhoneVerificationCodeResponse> {
    const user = (await this.usersRepository.findById(
      userId,
    )) as UserWithPhoneVerification | null;
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);

    if (!phoneNumber) {
      throw new BadRequestException('Phone number is required');
    }

    if (user.isPhoneVerified && user.phoneNumber === phoneNumber) {
      return {
        message: 'Phone number is already verified.',
        phoneNumber,
        isPhoneVerified: true,
      };
    }

    if (user.lastPhoneVerificationCodeSentAt) {
      const timeSinceLastSent =
        (Date.now() - user.lastPhoneVerificationCodeSentAt.getTime()) / 1000;
      if (timeSinceLastSent < PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(
          PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS - timeSinceLastSent,
        );
        throw new HttpException(
          `Please wait ${waitTime} seconds before requesting a new code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = this.generateVerificationCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(
      Date.now() + PHONE_VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.twilioSmsService.sendVerificationCode(phoneNumber, code);

    await this.usersRepository.update(userId, {
      phoneNumber,
      isPhoneVerified: false,
      phoneVerificationCode: codeHash,
      phoneVerificationCodeExpiresAt: expiresAt,
      phoneVerificationAttempts: 0,
      lastPhoneVerificationCodeSentAt: new Date(),
    });

    const response: SendPhoneVerificationCodeResponse = {
      message: 'Verification code sent via SMS.',
      phoneNumber,
      isPhoneVerified: false,
      expiresAt,
    };
    if (process.env.LOG_PHONE_VERIFICATION_CODE === 'true') {
      (response as SendPhoneVerificationCodeResponse & { code?: string }).code = code;
    }
    return response;
  }

  async verifyPhoneVerificationCode(
    userId: string,
    dto: VerifyPhoneVerificationCodeDto,
  ): Promise<VerifyPhoneVerificationCodeResponse> {
    const user = (await this.usersRepository.findById(
      userId,
    )) as UserWithPhoneVerification | null;
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.phoneNumber) {
      throw new BadRequestException(
        'Add a phone number to your account for account recovery and to unlock email updates.',
      );
    }

    if (user.isPhoneVerified) {
      return {
        message: 'Phone number is already verified.',
        phoneNumber: user.phoneNumber,
        isPhoneVerified: true,
      };
    }

    if (
      !user.phoneVerificationCode ||
      !user.phoneVerificationCodeExpiresAt
    ) {
      throw new BadRequestException(
        'No verification code found. Please request a new code.',
      );
    }

    if ((user.phoneVerificationAttempts ?? 0) >= MAX_PHONE_VERIFICATION_ATTEMPTS) {
      throw new HttpException(
        'Too many failed attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (new Date() > user.phoneVerificationCodeExpiresAt) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new code.',
      );
    }

    const codeHash = this.hashCode(dto.code.trim());
    const isCodeValid = crypto.timingSafeEqual(
      Buffer.from(codeHash),
      Buffer.from(user.phoneVerificationCode),
    );

    if (!isCodeValid) {
      await this.usersRepository.incrementPhoneVerificationAttempts(user.id);
      const remainingAttempts =
        MAX_PHONE_VERIFICATION_ATTEMPTS -
        (user.phoneVerificationAttempts ?? 0) -
        1;
      throw new BadRequestException(
        `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
      );
    }

    const updated = (await this.usersRepository.update(user.id, {
      isPhoneVerified: true,
      phoneVerificationCode: null,
      phoneVerificationCodeExpiresAt: null,
      phoneVerificationAttempts: 0,
    })) as UserWithPhoneVerification;

    return {
      message: 'Phone number verified successfully.',
      phoneNumber: (updated.phoneNumber ?? user.phoneNumber)!,
      isPhoneVerified: true,
    };
  }

  async completeOnboarding(
    userId: string,
    _dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResponse> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.hasCompletedOnboarding) {
      await this.usersRepository.markOnboardingComplete(userId);
    }

    return {
      message: 'Onboarding marked as complete',
      hasCompletedOnboarding: true,
    };
  }

  async deleteAccount(userId: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.usersRepository.delete(userId);
    return { message: 'Account deleted successfully' };
  }

  async listAllForAdmin(): Promise<
    { id: string; email: string; name: string; company: string | null; roles: UserRole[]; createdAt: Date }[]
  > {
    return this.usersRepository.findAllSafe();
  }

  async getAdminStats(): Promise<{
    totalUsers: number;
    totalLists: number;
    totalMappings: number;
    totalOverlaps: number;
  }> {
    const [totalUsers, totalLists, totalMappings, totalOverlaps] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.accountList.count(),
      (this.prisma as any).accountMatchDecision.count(),
      (this.prisma as any).observedOverlapNotification.count(),
    ]);
    return { totalUsers, totalLists, totalMappings, totalOverlaps };
  }

  async deleteUserAsAdmin(adminUserId: string, targetUserId: string): Promise<{ message: string }> {
    const admin = await this.usersRepository.findById(adminUserId);
    if (!admin || !admin.roles?.includes('Admin')) {
      throw new NotFoundException('Admin access required');
    }
    const target = await this.usersRepository.findById(targetUserId);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    await this.usersRepository.delete(targetUserId);
    return { message: 'User deleted successfully' };
  }

  private hasProfileChanges(user: User, dto: UpdateProfileDto): boolean {
    const currentRoles = [...(user.roles ?? [])].sort();
    const dtoRoles = Array.isArray(dto.roles) ? [...dto.roles].sort() : null;
    const rolesEqual =
      dtoRoles === null ||
      (dtoRoles.length === currentRoles.length &&
        dtoRoles.every((r, i) => currentRoles[i] === r));
    return (
      (typeof dto.name === 'string' && dto.name !== user.name) ||
      (typeof dto.email === 'string' && dto.email !== user.email) ||
      (typeof dto.company === 'string' &&
        dto.company !== (user.company ?? '')) ||
      (Array.isArray(dto.roles) && !rolesEqual)
    );
  }

  private async notifyConnectionsAboutProfileUpdate(updatedUser: User) {
    const recipientUserIds =
      await this.connectionsRepository.findAcceptedConnectionUserIds(
        updatedUser.id,
      );
    if (!recipientUserIds.length) {
      return;
    }

    await this.notificationsService.createUserProfileUpdatedNotifications({
      actorUserName: updatedUser.name,
      actorUserId: updatedUser.id,
      recipientUserIds,
    });
  }

  private generateVerificationCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private normalizePhoneNumber(phoneNumber: string): string | null {
    const trimmed = phoneNumber.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = trimmed.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException(
        'Phone number must be in E.164 format (example: +15551234567).',
      );
    }

    return normalized;
  }

}

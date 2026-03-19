import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    company?: string;
    roles: UserRole[];
    phoneNumber?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  // Email verification methods
  async updateEmailVerification(
    userId: string,
    data: {
      emailVerificationCode?: string | null;
      emailVerificationCodeExpiresAt?: Date | null;
      emailVerificationAttempts?: number;
      lastVerificationCodeSentAt?: Date;
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async setEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        emailVerificationCode: null,
        emailVerificationCodeExpiresAt: null,
        emailVerificationAttempts: 0,
      },
    });
  }

  async incrementVerificationAttempts(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationAttempts: { increment: 1 },
      },
    });
  }

  // Password reset methods
  async updatePasswordReset(
    userId: string,
    data: {
      passwordResetToken?: string | null;
      passwordResetTokenExpiresAt?: Date | null;
      passwordResetAttempts?: number;
      lastPasswordResetRequestAt?: Date;
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async findUserByPasswordResetToken(tokenHash: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetTokenExpiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
        passwordResetAttempts: 0,
      },
    });
  }

  async incrementPasswordResetAttempts(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetAttempts: { increment: 1 },
      },
    });
  }

  // Phone verification methods
  async updatePhoneVerification(
    userId: string,
    data: {
      phoneNumber?: string;
      isPhoneVerified?: boolean;
      phoneVerificationCode?: string | null;
      phoneVerificationCodeExpiresAt?: Date | null;
      phoneVerificationAttempts?: number;
      lastPhoneVerificationCodeSentAt?: Date;
      phoneVerificationSendCount?: number;
      phoneVerificationSendWindowStart?: Date;
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async setPhoneVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isPhoneVerified: true,
        phoneVerificationCode: null,
        phoneVerificationCodeExpiresAt: null,
        phoneVerificationAttempts: 0,
      },
    });
  }

  async incrementPhoneVerificationAttempts(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerificationAttempts: { increment: 1 },
      },
    });
  }
}

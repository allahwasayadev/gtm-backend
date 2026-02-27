import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async update(id: string, data: any): Promise<User> {
    return (this.prisma.user as any).update({
      where: { id },
      data,
    });
  }

  async incrementPhoneVerificationAttempts(id: string): Promise<User> {
    return (this.prisma.user as any).update({
      where: { id },
      data: {
        phoneVerificationAttempts: { increment: 1 },
      },
    });
  }

  async markOnboardingComplete(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        hasCompletedOnboarding: true,
      },
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}

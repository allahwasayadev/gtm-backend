import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthRepository } from './auth.repository';
import { SignupDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private authRepository: AuthRepository,
    private jwtService: JwtService,
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
    });

    const token = this.generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  private generateToken(userId: string, email: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
    });
  }
}

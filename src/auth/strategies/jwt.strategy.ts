import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * Absent on a normal session. 'activation' marks a short-lived token that may
   * ONLY be used to finish phone verification — never to access the app.
   */
  scope?: 'activation';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'ovrlap-secret-key-change-in-production',
    });
  }

  async validate(payload: JwtPayload) {
    // An activation token is signed with the same key, so it must be rejected
    // explicitly here or it would authenticate every guarded route in the app.
    if (payload.scope) {
      throw new UnauthorizedException('This token cannot be used to sign in');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        roles: true,
        emailVerified: true,
        createdAt: true,
        // Needed by JwtAuthGuard to enforce activation on EXISTING sessions:
        // a token issued before this flow has no scope and would otherwise
        // sail straight past login.
        isPhoneVerified: true,
        phoneNumber: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}

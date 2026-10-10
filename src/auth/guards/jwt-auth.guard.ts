import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentication plus the activation gate.
 *
 * The gate lives here rather than in each controller because of sessions that
 * already exist. A token issued before the SMS-first flow is a valid session:
 * it carries no scope, so JwtStrategy accepts it and the holder never passes
 * through login again. Without this check those users would reach the whole
 * application without ever verifying a number.
 *
 * An unverified session gets 403 rather than 401, so the client can route to
 * the activation screen instead of logging the user out and losing their
 * place. No SMS is sent here: the code goes out only when the user asks.
 *
 * Deliberately injection-free. Several modules that use this guard do not
 * import JwtModule, so requiring JwtService here would fail at runtime in
 * exactly those modules. The client exchanges its session for an activation
 * token via /auth/activation/from-session, which lives where JwtModule exists.
 */
export interface GatedUser {
  id: string;
  email: string;
  isPhoneVerified?: boolean;
  phoneNumber?: string | null;
}

/**
 * The activation gate, as a plain function so it can be tested without
 * standing up passport.
 *
 * Returns true to allow; throws 403 otherwise. Never 401: the session is
 * valid, and logging the user out would lose their place for no reason.
 */
export function assertPhoneVerified(user: GatedUser | undefined): boolean {
  if (!user) return false;
  if (user.isPhoneVerified) return true;

  throw new HttpException(
    {
      message: 'Verify your mobile number to continue.',
      code: 'PHONE_VERIFICATION_REQUIRED',
      email: user.email,
      phoneHint: user.phoneNumber
        ? `${user.phoneNumber.slice(0, 2)} •••• ••${user.phoneNumber.slice(-4)}`
        : null,
      needsPhoneNumber: !user.phoneNumber,
    },
    HttpStatus.FORBIDDEN,
  );
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: GatedUser }>();
    return assertPhoneVerified(request.user);
  }
}

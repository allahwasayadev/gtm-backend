import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
 * No JwtService here. Several modules that use this guard do not import
 * JwtModule, so requiring it would fail at runtime in exactly those modules.
 * The client exchanges its session for an activation token via
 * /auth/activation/from-session, which lives where JwtModule exists.
 * (Reflector is different: the core module provides it everywhere.)
 */

/** Metadata key for the opt-out below. */
export const SKIP_PHONE_GATE = 'skipPhoneGate';

/**
 * Authenticate this route, but do not require a verified phone.
 *
 * For the routes whose whole purpose is to BECOME verified. Asking for a code
 * sets isPhoneVerified back to false — the new number is not proved yet — so
 * without this the user's own next request, the one submitting that code, is
 * refused by the gate it exists to get them past. They receive a code they
 * can never spend.
 *
 * It is an opt-out and not an opt-in on purpose: a route added later is gated
 * unless someone says otherwise, in writing, at the route. Marking a route
 * removes only the verification check — authentication, rate limiting, and
 * the consent and opt-out gates are all untouched, and the handler still acts
 * solely on the caller's own account.
 */
export const SkipPhoneGate = () => SetMetadata(SKIP_PHONE_GATE, true);
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

/**
 * Reads the opt-out metadata. Constructed here rather than injected: this
 * guard must keep a zero-argument constructor, because the modules that use
 * it do not all import the providers an injected dependency would need.
 * Reflector itself has no dependencies, so constructing one costs nothing.
 */
const reflector = new Reflector();

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    // Authentication always runs; only the verification check is skippable.
    // A method-level @UseGuards would not have worked here: Nest ADDS those
    // to a controller's guards rather than replacing them, so this guard —
    // and its gate — would still have run.
    const skipGate = reflector.getAllAndOverride<boolean>(SKIP_PHONE_GATE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipGate) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: GatedUser }>();
    return assertPhoneVerified(request.user);
  }
}

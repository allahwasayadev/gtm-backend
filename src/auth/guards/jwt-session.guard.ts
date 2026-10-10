import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentication WITHOUT the activation gate.
 *
 * Used by exactly one route: the endpoint that trades an existing session for
 * an activation token. Guarding that with JwtAuthGuard would be circular — the
 * gate would reject the very request sent to get past the gate.
 */
@Injectable()
export class JwtSessionGuard extends AuthGuard('jwt') {}

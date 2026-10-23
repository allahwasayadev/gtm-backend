import { HttpException } from '@nestjs/common';
import { UsersController } from './users.controller';
import {
  assertPhoneVerified,
  JwtAuthGuard,
  SKIP_PHONE_GATE,
} from '../auth/guards/jwt-auth.guard';

/**
 * Who may reach the phone-verification endpoints.
 *
 * Sending a verification code sets isPhoneVerified back to false — the number
 * is not proved until the code comes back. Under the activation gate that
 * made the next step unreachable: the user could be sent a code they could
 * never submit, because submitting it required the verification that
 * submitting it would grant.
 *
 * These two routes therefore authenticate WITHOUT the gate. Everything else
 * on this controller stays behind it, which is the half of this that is easy
 * to lose by accident.
 */
describe('UsersController — the activation gate and the phone-verification routes', () => {
  /** Guards declared on the handler itself, if any. */
  const ownGuards = (method: keyof UsersController): unknown =>
    Reflect.getMetadata(
      '__guards__',
      UsersController.prototype[method] as object,
    ) as unknown;

  /** Is this route marked as exempt from the verified-phone check? */
  const skipsGate = (method: keyof UsersController): boolean =>
    Reflect.getMetadata(
      SKIP_PHONE_GATE,
      UsersController.prototype[method] as object,
    ) === true;

  const controllerGuards =
    (Reflect.getMetadata('__guards__', UsersController) as unknown[]) ?? [];

  it('gates the controller as a whole', () => {
    expect(controllerGuards).toContain(JwtAuthGuard);
  });

  describe('the two routes that exist to establish verification', () => {
    it.each([
      ['sendPhoneVerificationCode' as const],
      ['verifyPhoneVerificationCode' as const],
    ])('%s is exempt from the verified-phone check', (method) => {
      expect(skipsGate(method)).toBe(true);
    });

    // The exemption drops the verification check and nothing else. These
    // routes are still behind the controller's JwtAuthGuard, so an anonymous
    // caller never reaches them — which is what stops the exemption from
    // exposing another account's verification state.
    it('leaves authentication in place for them', () => {
      // No guard of their own: they inherit the controller's JwtAuthGuard,
      // which still authenticates. Only its verified-phone check is skipped,
      // so an anonymous caller never reaches them.
      expect(controllerGuards).toContain(JwtAuthGuard);
      expect(ownGuards('sendPhoneVerificationCode')).toBeUndefined();
      expect(ownGuards('verifyPhoneVerificationCode')).toBeUndefined();
    });
  });

  // The exemption must not spread. Each of these acts on account data and
  // must stay behind the gate.
  it.each([
    ['getProfile' as const],
    ['updateProfile' as const],
    ['withdrawSmsConsent' as const],
    ['completeOnboarding' as const],
    ['listUsers' as const],
    ['getAdminStats' as const],
  ])('%s is not exempted', (method) => {
    expect(skipsGate(method)).toBe(false);
  });

  describe('assertPhoneVerified, the gate itself', () => {
    it('admits a verified user', () => {
      expect(
        assertPhoneVerified({
          id: 'u1',
          email: 'u@example.test',
          isPhoneVerified: true,
        }),
      ).toBe(true);
    });

    it('refuses an unverified user with the code the client routes on', () => {
      expect.assertions(2);
      try {
        assertPhoneVerified({
          id: 'u1',
          email: 'u@example.test',
          isPhoneVerified: false,
          phoneNumber: '+12015550123',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getResponse()).toMatchObject({
          code: 'PHONE_VERIFICATION_REQUIRED',
        });
      }
    });

    it('refuses an absent user without throwing', () => {
      expect(assertPhoneVerified(undefined)).toBe(false);
    });
  });
});

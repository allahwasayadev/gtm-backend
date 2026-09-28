import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  SMS_USE_CASE,
  SmsConsentSourceValue,
} from './sms-consent.constants';

export interface ConsentContext {
  source: SmsConsentSourceValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records and enforces SMS consent.
 *
 * Every outbound message path must call assertMaySend() first. Consent is
 * recorded as an immutable event so that a consent-proof request can be
 * answered with the timestamp, the source, and the verbatim wording shown.
 */
@Injectable()
export class SmsConsentService {
  private readonly logger = new Logger(SmsConsentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Record an affirmative opt-in and set the user's current consent state.
   * Stores the wording verbatim so the record is self-contained.
   */
  async recordConsent(
    userId: string,
    phoneNumber: string,
    ctx: ConsentContext,
  ): Promise<void> {
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.smsConsentEvent.create({
        data: {
          userId,
          phoneNumber,
          action: 'granted',
          consentText: SMS_CONSENT_TEXT,
          consentVersion: SMS_CONSENT_VERSION,
          source: ctx.source,
          useCase: SMS_USE_CASE,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          smsConsent: true,
          smsConsentAt: now,
          smsConsentSource: ctx.source,
          smsConsentVersion: SMS_CONSENT_VERSION,
          // An explicit new opt-in clears a previous STOP for this account.
          smsOptedOut: false,
          smsOptedOutAt: null,
        },
      }),
    ]);

    this.logger.log(
      `SMS consent granted (user=${userId}, source=${ctx.source}, version=${SMS_CONSENT_VERSION})`,
    );
  }

  /** Record a STOP. Applies to every account holding that number. */
  async recordOptOut(phoneNumber: string, source: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { phoneNumber },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.smsConsentEvent.createMany({
        data:
          users.length > 0
            ? users.map((u) => ({
                userId: u.id,
                phoneNumber,
                action: 'revoked' as const,
                source,
                useCase: SMS_USE_CASE,
              }))
            : // Keep a record even for a number we do not recognise.
              [
                {
                  userId: null,
                  phoneNumber,
                  action: 'revoked' as const,
                  source,
                  useCase: SMS_USE_CASE,
                },
              ],
      }),
      this.prisma.user.updateMany({
        where: { phoneNumber },
        data: {
          smsConsent: false,
          smsOptedOut: true,
          smsOptedOutAt: new Date(),
        },
      }),
    ]);
  }

  /** Record a START/UNSTOP re-subscribe. */
  /**
   * Record a START/UNSTOP. This clears the carrier-level opt-out only.
   *
   * It deliberately does NOT restore `smsConsent`. Replying START tells the
   * messaging provider to resume delivery; it is not an informed opt-in to
   * Ovrlap's program, and the user may have no idea what they are re-consenting
   * to. The published SMS Terms say exactly this — "Replying START asks the
   * messaging provider to resume delivery, but it does not by itself restore
   * the consent setting Ovrlap holds" — so the code must match. To receive
   * messages again the user re-ticks the box in profile settings, which goes
   * through recordConsent() and captures the wording afresh.
   */
  async recordResubscribe(phoneNumber: string, source: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { phoneNumber },
      select: { id: true },
    });
    if (users.length === 0) return;

    await this.prisma.$transaction([
      this.prisma.smsConsentEvent.createMany({
        data: users.map((u) => ({
          userId: u.id,
          phoneNumber,
          action: 'resubscribed' as const,
          // No consentText/Version: this is not a consent capture.
          source,
          useCase: SMS_USE_CASE,
        })),
      }),
      this.prisma.user.updateMany({
        where: { phoneNumber },
        data: {
          smsOptedOut: false,
          smsOptedOutAt: null,
        },
      }),
    ]);
  }

  /**
   * Gate for every outbound send. Throws unless this user currently holds
   * consent for this number. Keyword replies (STOP/HELP confirmations) are
   * exempt by design and do not call this.
   */
  async assertMaySend(userId: string, phoneNumber: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { smsConsent: true, smsOptedOut: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    if (user.smsOptedOut) {
      this.logger.warn(`Blocked send to an opted-out number (user=${userId})`);
      throw new ForbiddenException(
        'This number has opted out of Ovrlap SMS. Reply START to the last ' +
          'Ovrlap message to resume, or verify by another method.',
      );
    }

    if (!user.smsConsent) {
      this.logger.warn(`Blocked send without consent (user=${userId})`);
      throw new ForbiddenException(
        'SMS consent is required before a verification code can be sent.',
      );
    }

    // Consent is given for a specific number. If the user has since switched
    // to a different one, the earlier consent does not carry over to it.
    const latestGrant = await this.prisma.smsConsentEvent.findFirst({
      where: { userId, action: 'granted' },
      orderBy: { createdAt: 'desc' },
      select: { phoneNumber: true },
    });

    if (!latestGrant || latestGrant.phoneNumber !== phoneNumber) {
      this.logger.warn(
        `Blocked send: consent on record is for a different number (user=${userId})`,
      );
      throw new ForbiddenException(
        'Please agree to receive SMS messages for this phone number before ' +
          'we send a verification code.',
      );
    }
  }

  /** Whether this number is currently opted out, for keyword handling. */
  async isOptedOut(phoneNumber: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber, smsOptedOut: true },
      select: { id: true },
    });
    return Boolean(user);
  }
}

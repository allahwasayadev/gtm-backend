import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SmsConsentService } from './sms-consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } from './sms-consent.constants';

/** Shape of the Prisma surface this service touches. */
interface PrismaMock {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  smsConsentEvent: {
    create: jest.Mock;
    createMany: jest.Mock;
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface ConsentEventRow {
  userId: string | null;
  phoneNumber: string;
  action: string;
}

/**
 * The send gate and the consent record are the two things an A2P 10DLC review
 * asks to see. Both are covered here.
 */
describe('SmsConsentService', () => {
  let service: SmsConsentService;
  let prisma: PrismaMock;

  const USER = 'user-1';
  const PHONE = '+15555550147';

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ id: USER }]),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      smsConsentEvent: {
        create: jest.fn(),
        createMany: jest.fn(),
        // Default: the most recent grant is for the number under test.
        findFirst: jest.fn().mockResolvedValue({ phoneNumber: PHONE }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsConsentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(SmsConsentService);
  });

  describe('assertMaySend', () => {
    it('allows a user who has consented and not opted out', async () => {
      prisma.user.findUnique.mockResolvedValue({
        smsConsent: true,
        smsOptedOut: false,
      });
      await expect(service.assertMaySend(USER, PHONE)).resolves.toBeUndefined();
    });

    it('blocks a user who never consented', async () => {
      prisma.user.findUnique.mockResolvedValue({
        smsConsent: false,
        smsOptedOut: false,
      });
      await expect(service.assertMaySend(USER, PHONE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    // The defect the audit found: STOP was recorded but never enforced, so
    // sends kept being generated to opted-out numbers.
    it('blocks a user who replied STOP, even if consent was given earlier', async () => {
      prisma.user.findUnique.mockResolvedValue({
        smsConsent: true,
        smsOptedOut: true,
      });
      await expect(service.assertMaySend(USER, PHONE)).rejects.toThrow(
        /opted out/i,
      );
    });

    // Consent is per-number: switching handsets requires a fresh opt-in.
    it('blocks when the consent on record is for a different number', async () => {
      prisma.user.findUnique.mockResolvedValue({
        smsConsent: true,
        smsOptedOut: false,
      });
      prisma.smsConsentEvent.findFirst.mockResolvedValue({
        phoneNumber: '+15555550999',
      });
      await expect(service.assertMaySend(USER, PHONE)).rejects.toThrow(
        /agree to receive SMS messages for this phone number/i,
      );
    });

    it('blocks when no grant event exists at all', async () => {
      prisma.user.findUnique.mockResolvedValue({
        smsConsent: true,
        smsOptedOut: false,
      });
      prisma.smsConsentEvent.findFirst.mockResolvedValue(null);
      await expect(service.assertMaySend(USER, PHONE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks when the user cannot be found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.assertMaySend(USER, PHONE)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('recordConsent', () => {
    it('stores the verbatim wording and version shown to the user', async () => {
      await service.recordConsent(USER, PHONE, {
        source: 'signup_form',
        ipAddress: '203.0.113.9',
        userAgent: 'jest',
      });

      const [createCall] = prisma.smsConsentEvent.create.mock.calls as [
        Record<string, unknown>,
      ][];
      expect(createCall[0].data).toMatchObject({
        userId: USER,
        phoneNumber: PHONE,
        action: 'granted',
        consentText: SMS_CONSENT_TEXT,
        consentVersion: SMS_CONSENT_VERSION,
        source: 'signup_form',
        ipAddress: '203.0.113.9',
        userAgent: 'jest',
      });
    });

    it('clears a previous opt-out, so an explicit new opt-in is honoured', async () => {
      await service.recordConsent(USER, PHONE, { source: 'profile_settings' });
      const [updateCall] = prisma.user.update.mock.calls as [
        Record<string, unknown>,
      ][];
      expect(updateCall[0].data).toMatchObject({
        smsConsent: true,
        smsOptedOut: false,
        smsOptedOutAt: null,
      });
    });
  });

  describe('recordResubscribe', () => {
    // The published SMS Terms say START does not restore the consent Ovrlap
    // holds; the code must not quietly do so.
    it('clears the carrier opt-out but does NOT restore consent', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER }]);
      await service.recordResubscribe(PHONE, 'sms_keyword');

      const [updateManyCall] = prisma.user.updateMany.mock.calls as [
        Record<string, unknown>,
      ][];
      const data = updateManyCall[0].data as Record<string, unknown>;
      expect(data).toMatchObject({ smsOptedOut: false, smsOptedOutAt: null });
      expect(data).not.toHaveProperty('smsConsent');
      expect(data).not.toHaveProperty('smsConsentAt');
    });

    it('records the event without capturing consent wording', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER }]);
      await service.recordResubscribe(PHONE, 'sms_keyword');
      const [manyCall] = prisma.smsConsentEvent.createMany.mock.calls as [
        { data: Record<string, unknown>[] },
      ][];
      expect(manyCall[0].data[0]).toMatchObject({ action: 'resubscribed' });
      expect(manyCall[0].data[0]).not.toHaveProperty('consentText');
    });
  });

  describe('recordOptOut', () => {
    it('revokes for every account sharing the number', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await service.recordOptOut(PHONE, 'sms_keyword');

      const [manyCall] = prisma.smsConsentEvent.createMany.mock.calls as [
        { data: ConsentEventRow[] },
      ][];
      expect(manyCall[0].data).toHaveLength(2);
      expect(
        manyCall[0].data.every((r: ConsentEventRow) => r.action === 'revoked'),
      ).toBe(true);

      const [updateManyCall] = prisma.user.updateMany.mock.calls as [
        Record<string, unknown>,
      ][];
      expect(updateManyCall[0].where).toEqual({ phoneNumber: PHONE });
      expect(updateManyCall[0].data).toMatchObject({
        smsConsent: false,
        smsOptedOut: true,
      });
    });

    it('still records a revocation for an unrecognised number', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.recordOptOut(PHONE, 'sms_keyword');

      const [manyCall] = prisma.smsConsentEvent.createMany.mock.calls as [
        { data: ConsentEventRow[] },
      ][];
      expect(manyCall[0].data).toHaveLength(1);
      expect(manyCall[0].data[0]).toMatchObject({
        userId: null,
        phoneNumber: PHONE,
        action: 'revoked',
      });
    });
  });

  /**
   * recordConsent treats a fresh opt-in as resubscribing and clears
   * smsOptedOut. recordConsentIfMissing must NOT, because it runs at the
   * point of send — if it cleared the flag, a STOP'd number would be silently
   * unblocked by the very act of asking for a code.
   */
  describe('recordConsentIfMissing', () => {
    it('never clears an opt-out', async () => {
      prisma.smsConsentEvent.findFirst.mockResolvedValue(null);
      await service.recordConsentIfMissing('u1', '+14155550123', {
        source: 'verify_phone_screen',
      });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.smsConsent).toBe(true);
      expect(data).not.toHaveProperty('smsOptedOut');
      expect(data).not.toHaveProperty('smsOptedOutAt');
    });

    it('is idempotent for a number already on record', async () => {
      prisma.smsConsentEvent.findFirst.mockResolvedValue({
        id: 'e1',
        phoneNumber: '+14155550123',
      });
      await service.recordConsentIfMissing('u1', '+14155550123', {
        source: 'verify_phone_screen',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records again when the number has changed', async () => {
      prisma.smsConsentEvent.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ phoneNumber: '+14155550999' });
      await service.recordConsentIfMissing('u1', '+14155550123', {
        source: 'verify_phone_screen',
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});

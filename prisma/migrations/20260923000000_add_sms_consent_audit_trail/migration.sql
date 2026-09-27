-- A2P 10DLC consent recording.
-- Adds current consent state to users, plus an immutable audit trail so a
-- consent-proof request can be answered with the timestamp, the source and the
-- verbatim wording shown at the moment of opt-in.

-- CreateEnum
CREATE TYPE "SmsConsentAction" AS ENUM ('granted', 'revoked', 'resubscribed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "smsConsentAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "smsConsentSource" TEXT;
ALTER TABLE "users" ADD COLUMN "smsConsentVersion" TEXT;
ALTER TABLE "users" ADD COLUMN "smsOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sms_consent_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "action" "SmsConsentAction" NOT NULL,
    "consentText" TEXT,
    "consentVersion" TEXT,
    "source" TEXT NOT NULL,
    "useCase" TEXT NOT NULL DEFAULT 'account_verification',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_consent_events_phoneNumber_idx" ON "sms_consent_events"("phoneNumber");
CREATE INDEX "sms_consent_events_userId_idx" ON "sms_consent_events"("userId");
CREATE INDEX "sms_consent_events_createdAt_idx" ON "sms_consent_events"("createdAt");

-- AddForeignKey
ALTER TABLE "sms_consent_events" ADD CONSTRAINT "sms_consent_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing users have never given recorded consent, so they start at false.
-- Anyone previously opted out stays opted out.
UPDATE "users" SET "smsOptedOutAt" = NOW() WHERE "smsOptedOut" = true;

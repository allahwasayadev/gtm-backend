-- AlterTable
ALTER TABLE "users" ADD COLUMN "smsOptedOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "phoneVerificationSendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "phoneVerificationSendWindowStart" TIMESTAMP(3);

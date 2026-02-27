-- AlterTable
ALTER TABLE "users"
ADD COLUMN "phoneNumber" TEXT,
ADD COLUMN "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "phoneVerificationCode" TEXT,
ADD COLUMN "phoneVerificationCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN "phoneVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastPhoneVerificationCodeSentAt" TIMESTAMP(3);

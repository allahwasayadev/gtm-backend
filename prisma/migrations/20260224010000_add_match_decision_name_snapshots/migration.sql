-- AlterTable
ALTER TABLE "account_match_decisions"
ADD COLUMN "yourNormalizedNameSnapshot" TEXT,
ADD COLUMN "theirNormalizedNameSnapshot" TEXT;

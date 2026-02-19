-- CreateTable
CREATE TABLE "account_match_decisions" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "yourAccountId" TEXT NOT NULL,
    "theirAccountId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_match_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_match_decisions_connectionId_idx" ON "account_match_decisions"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "account_match_decisions_connectionId_yourAccountId_theirAccou_key" ON "account_match_decisions"("connectionId", "yourAccountId", "theirAccountId");

-- AddForeignKey
ALTER TABLE "account_match_decisions" ADD CONSTRAINT "account_match_decisions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

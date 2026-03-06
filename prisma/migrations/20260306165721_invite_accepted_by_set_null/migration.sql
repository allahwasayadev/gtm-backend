-- CreateIndex
CREATE INDEX "invites_tokenHash_idx" ON "invites"("tokenHash");

-- RenameIndex
ALTER INDEX "account_match_decisions_connectionId_yourAccountId_theirAccou_k" RENAME TO "account_match_decisions_connectionId_yourAccountId_theirAcc_key";

-- RenameIndex
ALTER INDEX "observed_overlap_notifications_userId_connectionId_senderNorma_" RENAME TO "observed_overlap_notifications_userId_connectionId_senderNo_key";

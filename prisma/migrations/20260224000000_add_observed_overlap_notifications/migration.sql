-- CreateTable
CREATE TABLE "observed_overlap_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "senderNormalizedName" TEXT NOT NULL,
    "receiverNormalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observed_overlap_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observed_overlap_notifications_connectionId_userId_idx" ON "observed_overlap_notifications"("connectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "observed_overlap_notifications_userId_connectionId_senderNorma_key" ON "observed_overlap_notifications"("userId", "connectionId", "senderNormalizedName", "receiverNormalizedName");

-- AddForeignKey
ALTER TABLE "observed_overlap_notifications" ADD CONSTRAINT "observed_overlap_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observed_overlap_notifications" ADD CONSTRAINT "observed_overlap_notifications_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

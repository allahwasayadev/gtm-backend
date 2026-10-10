-- Marker for "this signup has never activated", used by the reclaim rule.
--
-- Reclaiming deletes the account, cascading to its account lists, connections,
-- notifications, observed overlaps and sent invites. So the marker is opt-IN:
-- only rows the new signup flow creates carry a timestamp, and activation
-- clears it.
--
-- This direction is deliberate. Deployment applies schema changes with
-- `prisma db push`, which does NOT execute migration SQL, so a backfill here
-- would silently never run. With an opt-in marker that does not matter: every
-- existing row defaults to NULL and is therefore permanently un-reclaimable,
-- with or without this file being executed.

ALTER TABLE "users" ADD COLUMN "pendingSignupSince" TIMESTAMP(3);

CREATE INDEX "users_pendingSignupSince_idx" ON "users"("pendingSignupSince");

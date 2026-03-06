-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Admin', 'OEM', 'Reseller');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];

-- Backfill: isOemSeller true -> OEM role, false -> Reseller role
UPDATE "users" SET "roles" = ARRAY['OEM']::"UserRole"[] WHERE "isOemSeller" = true;
UPDATE "users" SET "roles" = ARRAY['Reseller']::"UserRole"[] WHERE "isOemSeller" = false;

-- Ensure no nulls
UPDATE "users" SET "roles" = ARRAY['Reseller']::"UserRole"[] WHERE "roles" = ARRAY[]::"UserRole"[] OR "roles" IS NULL;

ALTER TABLE "users" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"UserRole"[];

-- DropColumn
ALTER TABLE "users" DROP COLUMN "isOemSeller";

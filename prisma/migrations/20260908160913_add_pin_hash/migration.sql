-- AlterTable
ALTER TABLE "credentials" ADD COLUMN     "pin_hash" TEXT,
ALTER COLUMN "password_hash" DROP NOT NULL;

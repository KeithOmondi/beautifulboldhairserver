ALTER TABLE "Feedback" ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "removedAt" TIMESTAMP(3), ADD COLUMN "removedBy" TEXT, ADD COLUMN "removalReason" TEXT;

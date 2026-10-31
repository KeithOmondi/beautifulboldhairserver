-- Branch identity
ALTER TABLE "Branch" ADD COLUMN "slug" TEXT, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
UPDATE "Branch" SET "slug" = COALESCE(NULLIF(trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'branch') || '-' || substr("id", length("id") - 3);
ALTER TABLE "Branch" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Branch_slug_key" ON "Branch"("slug");

-- Staff who may switch branches: existing owners keep working across the business
ALTER TABLE "Staff" ADD COLUMN "canSwitchBranches" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Staff" SET "canSwitchBranches" = true WHERE "role" = 'OWNER';

-- Customers per branch: the same phone may be a customer of both sides
DROP INDEX "Client_phone_key";
CREATE UNIQUE INDEX "Client_branchId_phone_key" ON "Client"("branchId", "phone");

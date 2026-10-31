CREATE TABLE "HeroSlide" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PHOTO_TEXT',
    "imageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "eyebrow" TEXT,
    "headline" TEXT,
    "subtext" TEXT,
    "buttonLabel" TEXT,
    "linkTo" TEXT,
    "align" TEXT NOT NULL DEFAULT 'left',
    "overlay" INTEGER NOT NULL DEFAULT 45,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroSlide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HeroSlide_branchId_sortOrder_idx" ON "HeroSlide"("branchId", "sortOrder");

ALTER TABLE "HeroSlide" ADD CONSTRAINT "HeroSlide_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Branch"
  ADD COLUMN "tagline" TEXT,
  ADD COLUMN "about" TEXT,
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "whatsapp" TEXT,
  ADD COLUMN "hoursText" TEXT;

ALTER TABLE "Booking" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "Feedback" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE TABLE "GalleryImage" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GalleryImage_publicId_key" ON "GalleryImage"("publicId");
CREATE INDEX "GalleryImage_branchId_isPublished_sortOrder_idx" ON "GalleryImage"("branchId", "isPublished", "sortOrder");
ALTER TABLE "GalleryImage" ADD CONSTRAINT "GalleryImage_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Complaint" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "bookingId" TEXT,
  "clientId" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "message" TEXT NOT NULL,
  "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Complaint_branchId_status_createdAt_idx" ON "Complaint"("branchId", "status", "createdAt");
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "referrer" TEXT,
  "device" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- Branch contact details
ALTER TABLE "Branch" ADD COLUMN "phone" TEXT, ADD COLUMN "address" TEXT;

-- Service description for the public booking page
ALTER TABLE "Service" ADD COLUMN "description" TEXT;

-- Staff: public listing + default weekly schedule
ALTER TABLE "Staff"
  ADD COLUMN "isBookable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "weeklyHours" JSONB;

-- Booking: refund tracking + reminder tracking
ALTER TABLE "Booking"
  ADD COLUMN "depositRefundDue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- SlotHold: carries the whole pending booking until the M-Pesa deposit lands
ALTER TABLE "SlotHold"
  ADD COLUMN "serviceId" TEXT,
  ADD COLUMN "depositAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "bookingId" TEXT,
  ADD COLUMN "failureReason" TEXT;

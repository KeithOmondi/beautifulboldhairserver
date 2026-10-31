-- The time the money was actually paid (M-Pesa's transaction time), separate from when the row was written.
ALTER TABLE "Payment" ADD COLUMN "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Payment" SET "paidAt" = "createdAt";
CREATE INDEX "Payment_branchId_paidAt_idx" ON "Payment"("branchId", "paidAt");

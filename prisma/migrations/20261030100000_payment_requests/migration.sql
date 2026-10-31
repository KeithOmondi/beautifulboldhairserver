-- M-Pesa prompts sent by the front desk to collect an outstanding balance.
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutId" TEXT,
    "failureReason" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRequest_mpesaCheckoutId_key" ON "PaymentRequest"("mpesaCheckoutId");
CREATE INDEX "PaymentRequest_bookingId_createdAt_idx" ON "PaymentRequest"("bookingId", "createdAt");

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

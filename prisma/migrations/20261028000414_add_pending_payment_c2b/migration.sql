-- CreateTable
CREATE TABLE "PendingPayment" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "mpesaReceipt" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "accountRef" TEXT,
    "isAssigned" BOOLEAN NOT NULL DEFAULT false,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingPayment_mpesaReceipt_key" ON "PendingPayment"("mpesaReceipt");

-- CreateIndex
CREATE INDEX "PendingPayment_branchId_isAssigned_idx" ON "PendingPayment"("branchId", "isAssigned");

-- AddForeignKey
ALTER TABLE "PendingPayment" ADD CONSTRAINT "PendingPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

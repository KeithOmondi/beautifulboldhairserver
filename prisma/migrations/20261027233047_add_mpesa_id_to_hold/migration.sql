/*
  Warnings:

  - A unique constraint covering the columns `[mpesaCheckoutId]` on the table `SlotHold` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SlotHold" ADD COLUMN     "mpesaCheckoutId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SlotHold_mpesaCheckoutId_key" ON "SlotHold"("mpesaCheckoutId");

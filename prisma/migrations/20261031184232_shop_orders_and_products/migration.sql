-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "shopCodAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shopDeliveryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shopFreeOver" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "shopOrderId" TEXT;

-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN     "category" TEXT,
ADD COLUMN     "compareAtPrice" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "branchId" TEXT NOT NULL,
    "clientId" TEXT,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "fulfilment" TEXT NOT NULL,
    "address" TEXT,
    "area" TEXT,
    "notes" TEXT,
    "subtotal" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payMethod" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "mpesaCheckoutId" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stockItemId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "image" TEXT,

    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_orderNo_key" ON "ShopOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_token_key" ON "ShopOrder"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_mpesaCheckoutId_key" ON "ShopOrder"("mpesaCheckoutId");

-- CreateIndex
CREATE INDEX "ShopOrder_branchId_status_createdAt_idx" ON "ShopOrder"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_phone_idx" ON "ShopOrder"("phone");

-- CreateIndex
CREATE INDEX "ShopOrderItem_orderId_idx" ON "ShopOrderItem"("orderId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

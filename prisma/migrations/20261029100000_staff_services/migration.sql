ALTER TABLE "BookingSettings" ADD COLUMN "showStylists" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "StaffService" (
  "staffId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  CONSTRAINT "StaffService_pkey" PRIMARY KEY ("staffId","serviceId")
);
CREATE INDEX "StaffService_serviceId_idx" ON "StaffService"("serviceId");
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

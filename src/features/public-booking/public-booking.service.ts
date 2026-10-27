import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { env } from "../../config/env";
import { normalizePhone } from "../../utils/phone";
import { getAvailableSlots } from "../availability/availability.service";
import { createBooking } from "../booking/booking.service";
import { initiateStkPush } from "../../integrations/mpesa"; 
import type { 
  VerifyOtpInput, 
  HoldSlotInput, 
  ConfirmPublicBookingInput 
} from "./public-booking.types";

// ─── OTP FLOW ───

export async function requestClientOtp(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new AppError(400, "Invalid phone number", "INVALID_PHONE");

  const recentOtps = await prisma.otpCode.count({
    where: {
      phone,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  if (recentOtps >= env.OTP_RATE_LIMIT_PER_HOUR) {
    throw new AppError(429, "Too many OTP requests. Please try again later.", "RATE_LIMITED");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.otpCode.create({
    data: { phone, code, expiresAt, channel: "SMS" },
  });

  console.log(`[DEV] Public Booking OTP for ${phone} is: ${code}`);
  
  return { message: "OTP sent successfully" };
}

export async function verifyClientOtp(fastify: any, data: VerifyOtpInput) {
  const phone = normalizePhone(data.phone);
  if (!phone) throw new AppError(400, "Invalid phone number", "INVALID_PHONE");

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      phone,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord || otpRecord.code !== data.code) {
    throw new AppError(400, "Invalid or expired OTP", "INVALID_OTP");
  }

  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { usedAt: new Date() },
  });

  const client = await prisma.client.findFirst({ where: { phone } });

  const token = fastify.jwt.sign(
    { 
      type: "client", 
      phone, 
      clientId: client?.id || null 
    },
    { expiresIn: "15m" }
  );

  return {
    token,
    client: {
      id: client?.id || null,
      name: client?.name || null,
      phone,
    },
  };
}

// ─── SLOT HOLD & M-PESA FLOW ───

export async function holdSlot(branchId: string, phone: string, data: HoldSlotInput) {
  const startDate = new Date(data.startAt);
  const nairobiDate = new Date(startDate.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
  const dateStr = nairobiDate.toISOString().split("T")[0]!;
  const startTimeStr = `${String(nairobiDate.getHours()).padStart(2, "0")}:${String(nairobiDate.getMinutes()).padStart(2, "0")}`;

  const availability = await getAvailableSlots(branchId, {
    staffId: data.staffId,
    date: dateStr,
    serviceId: data.serviceId,
  });

  const isSlotFree = availability.availableSlots.some(
    (slot) => slot.startTime === startTimeStr
  );

  if (!isSlotFree) {
    throw new AppError(409, "This time slot is no longer available", "SLOT_TAKEN");
  }

  const service = await prisma.service.findUnique({ where: { id: data.serviceId } });
  if (!service) throw new AppError(404, "Service not found", "NOT_FOUND");
  
  const endAt = new Date(startDate);
  endAt.setMinutes(endAt.getMinutes() + service.durationMin);

  // Clean up expired holds
  await prisma.slotHold.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  const expiresAt = new Date(Date.now() + env.SLOT_HOLD_MINUTES * 60 * 1000);

  // 1. Create the hold
  const hold = await prisma.slotHold.create({
    data: {
      branchId,
      staffId: data.staffId,
      startAt: startDate,
      endAt,
      clientPhone: phone,
      clientName: data.name,
      clientAllergies: data.allergies ?? null,
      expiresAt,
    },
    include: { staff: true },
  });

  // 2. Initiate M-Pesa STK Push
  const depositAmount = 100; 
  
  const stkResponse = await initiateStkPush({
    phone: phone,
    amount: depositAmount,
    accountReference: hold.id.slice(-10),
    description: "Booking Deposit",
  });

  if (!stkResponse.success || !stkResponse.checkoutRequestId) {
    await prisma.slotHold.delete({ where: { id: hold.id } });
    throw new AppError(500, "Failed to initiate M-Pesa payment. Please try again.", "MPESA_FAILED");
  }

  // 3. Save the CheckoutID (FIX: Using non-null assertion `!`)
  await prisma.slotHold.update({
    where: { id: hold.id },
    data: { mpesaCheckoutId: stkResponse.checkoutRequestId },
  });

  return {
    holdId: hold.id,
    expiresAt: hold.expiresAt,
    staffName: hold.staff.name,
    serviceName: service.name,
    startAt: hold.startAt,
    message: "Please check your phone to enter your M-Pesa PIN to secure this booking.",
    mpesaCheckoutId: stkResponse.checkoutRequestId,
  };
}

// ─── BOOKING FLOW ───

export async function confirmPublicBooking(
  branchId: string, 
  phone: string, 
  data: ConfirmPublicBookingInput
) {
  const hold = await prisma.slotHold.findFirst({
    where: {
      id: data.holdId,
      clientPhone: phone,
      expiresAt: { gt: new Date() },
    },
    include: { staff: true },
  });

  if (!hold) {
    throw new AppError(400, "Hold has expired or is invalid. Please select a slot again.", "INVALID_HOLD");
  }

  let client = await prisma.client.findFirst({ where: { phone, branchId } });
  
  if (!client) {
    client = await prisma.client.create({
      data: {
        branchId,
        phone,
        name: hold.clientName || data.name,
        allergies: hold.clientAllergies ?? data.allergies ?? null,
        isFirstLash: data.isFirstLash ?? false, 
      },
    });
  }

  const durationMin = (hold.endAt.getTime() - hold.startAt.getTime()) / 60000;
  const service = await prisma.service.findFirst({
    where: { branchId, durationMin: Math.floor(durationMin), isActive: true }
  });

  if (!service) {
    throw new AppError(500, "Could not determine service for this hold", "INTERNAL_ERROR");
  }

  const bookingResponse = await createBooking(branchId, {
    clientId: client.id,
    staffId: hold.staffId,
    serviceId: service.id,
    startAt: hold.startAt.toISOString(),
    source: "ONLINE",
    notes: "Public booking via OTP + M-Pesa",
  });

  await prisma.slotHold.delete({ where: { id: hold.id } });

  return {
    bookingId: bookingResponse.bookingId,
    manageToken: bookingResponse.manageToken,
    startAt: bookingResponse.startAt,
    endAt: bookingResponse.endAt,
    staffName: bookingResponse.staffName,
    serviceName: bookingResponse.serviceName,
    totalPrice: bookingResponse.price,
    depositAmount: 100,
    depositPaid: true,
  };
}
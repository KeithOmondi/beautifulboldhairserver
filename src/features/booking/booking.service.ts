import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { CreateBookingDto, RescheduleBookingDto } from "./booking.schema";
import { getAvailableSlots } from "../availability/availability.service";
import { randomBytes } from "crypto";

/**
 * Converts a UTC Date to Nairobi date string ("YYYY-MM-DD") and time string ("HH:mm").
 * The Availability Engine works in Nairobi time, so we must compare in the same timezone.
 */
function toNairobiDateAndTime(utcDate: Date): { dateStr: string; timeStr: string } {
  const nairobi = new Date(utcDate.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
  const dateStr = nairobi.toISOString().split("T")[0]!;
  const hours = String(nairobi.getHours()).padStart(2, "0");
  const mins = String(nairobi.getMinutes()).padStart(2, "0");
  return { dateStr, timeStr: `${hours}:${mins}` };
}

export async function createBooking(branchId: string, data: CreateBookingDto) {
  // 1. Verify Client belongs to this branch
  const client = await prisma.client.findFirst({ where: { id: data.clientId, branchId } });
  if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

  // 2. Verify Service belongs to this branch and is active
  const service = await prisma.service.findFirst({ 
    where: { id: data.serviceId, branchId, isActive: true } 
  });
  if (!service) throw new AppError(404, "Service not found or inactive", "NOT_FOUND");

  // 3. Parse start time and convert to NAIROBI time for comparison
  const startDate = new Date(data.startAt);
  const { dateStr, timeStr: startTimeStr } = toNairobiDateAndTime(startDate);

  // 4. Double-check with the Availability Engine (which works in Nairobi time)
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

  // 5. Calculate endAt time
  const endAt = new Date(startDate);
  endAt.setMinutes(endAt.getMinutes() + service.durationMin);

  // 6. Generate a secure manageToken
  const manageToken = randomBytes(24).toString("hex");

  // 7. Create the booking
  try {
    const booking = await prisma.booking.create({
      data: {
        branchId,
        clientId: data.clientId,
        staffId: data.staffId,
        serviceId: data.serviceId,
        startAt: startDate,
        endAt,
        status: "CONFIRMED",
        source: data.source,
        price: service.price,
        manageToken,
        notes: data.notes ?? null,
        allergies: client.allergies,
      },
      include: {
        staff: { select: { name: true } },
        service: { select: { name: true } },
        client: { select: { name: true } },
      },
    });

    const b = booking as any;

    return {
      bookingId: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      staffName: b.staff.name,
      serviceName: b.service.name,
      clientName: b.client.name,
      price: b.price,
      manageToken: b.manageToken,
    };
  } catch (error: any) {
    if (error.code === "23P01" || error.message?.includes("Booking_no_overlap")) {
      throw new AppError(409, "Double booking detected at database level", "SLOT_TAKEN");
    }
    throw error;
  }
}

export async function listBookings(branchId: string, dateString?: string) {
  const whereClause: any = { branchId };

  if (dateString) {
    const dayStart = new Date(`${dateString}T00:00:00+03:00`);
    const dayEnd = new Date(`${dateString}T23:59:59+03:00`);
    whereClause.startAt = { gte: dayStart, lte: dayEnd };
  }

  return prisma.booking.findMany({
    where: whereClause,
    include: {
      client: { select: { name: true, phone: true } },
      staff: { select: { name: true } },
      service: { select: { name: true, durationMin: true } },
    },
    orderBy: { startAt: "asc" },
  });
}

export async function cancelBooking(branchId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, branchId },
  });

  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED") throw new AppError(400, "Booking is already cancelled", "BAD_REQUEST");

  await prisma.booking.update({
    where: { id: bookingId },
    data: { 
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  return { message: "Booking cancelled successfully" };
}

export async function rescheduleBooking(branchId: string, bookingId: string, data: RescheduleBookingDto) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, branchId },
    include: { service: true },
  });

  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");

  const newStartDate = new Date(data.newStartAt);
  const { dateStr, timeStr: startTimeStr } = toNairobiDateAndTime(newStartDate);

  const availability = await getAvailableSlots(branchId, {
    staffId: data.staffId || booking.staffId,
    date: dateStr,
    serviceId: booking.serviceId,
  });

  const isSlotFree = availability.availableSlots.some(
    (slot) => slot.startTime === startTimeStr
  );

  if (!isSlotFree) {
    throw new AppError(409, "The new time slot is not available", "SLOT_TAKEN");
  }

  const newEndAt = new Date(newStartDate);
  newEndAt.setMinutes(newEndAt.getMinutes() + booking.service.durationMin);

  return prisma.booking.update({
    where: { id: bookingId },
    data: {
      startAt: newStartDate,
      endAt: newEndAt,
      staffId: data.staffId || booking.staffId,
    },
  });
}
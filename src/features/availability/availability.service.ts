import { prisma } from "../../config/db";
import { getMinutesFromMidnight } from "../../utils/time";
import { AppError } from "../../utils/errors";
import type { AvailabilityResponse, BusyBlock, TimeSlot } from "./availability.types";
import type { GetAvailabilityDto } from "./availability.schema";

export async function getAvailableSlots(
  branchId: string,
  data: GetAvailabilityDto
): Promise<AvailabilityResponse> {
  const { staffId, date, serviceId } = data;

  // 1. Verify staff belongs to branch
  const staff = await prisma.staff.findFirst({ where: { id: staffId, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  // 2. Verify service exists
  const service = await prisma.service.findFirst({ where: { id: serviceId, branchId } });
  if (!service) throw new AppError(404, "Service not found", "NOT_FOUND");

  const baseResponse: AvailabilityResponse = {
    staffId,
    date,
    serviceId,
    serviceName: service.name,
    durationMin: service.durationMin,
    isWorking: false,
    availableSlots: [],
  };

  // 3. Define the target day range (Nairobi time)
  const dayStart = new Date(`${date}T00:00:00+03:00`);
  const dayEnd = new Date(`${date}T23:59:59+03:00`);

  // 4. Fetch the shift for this staff member
  const shift = await prisma.shift.findFirst({
    where: {
      staffId,
      startAt: { lte: dayEnd },
      endAt: { gte: dayStart },
    },
    include: { breaks: true },
  });

  // If the staff member has no shift on this day, return immediately
  if (!shift) return baseResponse;

  baseResponse.isWorking = true;

  // 5. Fetch existing bookings and time-offs
  const bookings = await prisma.booking.findMany({
    where: {
      staffId,
      startAt: { gte: dayStart, lte: dayEnd },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
  });

  const timeOffs = await prisma.timeOff.findMany({
    where: {
      OR: [{ staffId }, { staffId: null }],
      startAt: { lte: dayEnd },
      endAt: { gte: dayStart },
    },
  });

  // 6. Convert everything to minutes from midnight
  const shiftStart = getMinutesFromMidnight(shift.startAt);
  const shiftEnd = getMinutesFromMidnight(shift.endAt);
  
  // Fetch branch settings for buffer time
  const settings = await prisma.bookingSettings.findUnique({ where: { branchId } });
  const bufferMinutes = settings?.bufferMinutes ?? 15;

  const busyBlocks: BusyBlock[] = [];

  bookings.forEach((b) => {
    busyBlocks.push({
      start: getMinutesFromMidnight(b.startAt),
      end: getMinutesFromMidnight(b.endAt) + bufferMinutes,
      reason: "BOOKING",
    });
  });

  shift.breaks.forEach((brk) => {
    busyBlocks.push({
      start: getMinutesFromMidnight(brk.startAt),
      end: getMinutesFromMidnight(brk.endAt),
      reason: "BREAK",
    });
  });

  timeOffs.forEach((to) => {
    busyBlocks.push({
      start: getMinutesFromMidnight(to.startAt),
      end: getMinutesFromMidnight(to.endAt),
      reason: "TIME_OFF",
    });
  });

  // 7. Generate valid slots
  const availableSlots: TimeSlot[] = [];
  const STEP_SIZE = 15;
  const serviceDuration = service.durationMin;

  for (let time = shiftStart; time + serviceDuration <= shiftEnd; time += STEP_SIZE) {
    const slotEnd = time + serviceDuration;

    const isOverlapping = busyBlocks.some(
      (busy) => time < busy.end && slotEnd > busy.start
    );

    if (!isOverlapping) {
      const startHours = Math.floor(time / 60).toString().padStart(2, "0");
      const startMins = (time % 60).toString().padStart(2, "0");

      const endHours = Math.floor(slotEnd / 60).toString().padStart(2, "0");
      const endMins = (slotEnd % 60).toString().padStart(2, "0");

      availableSlots.push({
        startTime: `${startHours}:${startMins}`,
        endTime: `${endHours}:${endMins}`,
      });
    }
  }

  baseResponse.availableSlots = availableSlots;
  return baseResponse;
}
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { addDays, dayEnd, dayStart, nairobiDateString, todayString } from "../../utils/time";
import { clampToOpening, type OpeningHours } from "../../utils/opening-hours";
import { computeSlots, windowsFromWeeklyHours, type Interval, type WeeklyHours } from "../../engines/availability/engine";
import type { AvailabilityResponse } from "./availability.types";
import type { GetAvailabilityDto } from "./availability.schema";

export interface AvailabilityOptions {
  /** Public bookings honour minimum notice and the booking horizon; staff can book "right now". */
  publicRules?: boolean;
  /** Ignore this booking's own time (rescheduling). */
  excludeBookingId?: string;
  /** Ignore this hold (confirming the hold we are about to turn into a booking). */
  excludeHoldId?: string;
}

const DEFAULT_SETTINGS = { bufferMinutes: 15, minNoticeHours: 3, maxAheadDays: 60 };

async function getSettings(branchId: string) {
  const s = await prisma.bookingSettings.findUnique({ where: { branchId } });
  return s ?? { ...DEFAULT_SETTINGS, cancelWindowHours: 24, depositRequired: false, depositAmount: 0, maxBookingsPerDay: 2 };
}

/** Computes free start times for one staff member and one service on one day. */
export async function getAvailableSlots(
  branchId: string,
  data: GetAvailabilityDto,
  opts: AvailabilityOptions = {},
): Promise<AvailabilityResponse> {
  const { staffId, date, serviceId } = data;

  const [staff, service, settings] = await Promise.all([
    prisma.staff.findFirst({ where: { id: staffId, branchId, isActive: true } }),
    prisma.service.findFirst({ where: { id: serviceId, branchId, isActive: true } }),
    getSettings(branchId),
  ]);
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");
  if (!service) throw new AppError(404, "Service not found", "NOT_FOUND");

  const base: AvailabilityResponse = {
    staffId,
    date,
    serviceId,
    serviceName: service.name,
    durationMin: service.durationMin,
    isWorking: false,
    availableSlots: [],
  };

  if (opts.publicRules) {
    const today = todayString();
    if (date < today || date > addDays(today, settings.maxAheadDays)) return base;
  }

  const from = dayStart(date);
  const to = dayEnd(date);

  const [shifts, bookings, holds, timeOffs] = await Promise.all([
    prisma.shift.findMany({
      where: { staffId, startAt: { lt: to }, endAt: { gt: from } },
      include: { breaks: true },
    }),
    prisma.booking.findMany({
      where: {
        staffId,
        startAt: { lt: to },
        endAt: { gt: from },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.slotHold.findMany({
      where: {
        staffId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        startAt: { lt: to },
        endAt: { gt: from },
        ...(opts.excludeHoldId ? { id: { not: opts.excludeHoldId } } : {}),
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.timeOff.findMany({
      where: { branchId, OR: [{ staffId }, { staffId: null }], startAt: { lt: to }, endAt: { gt: from } },
      select: { startAt: true, endAt: true },
    }),
  ]);

  // Explicit shifts for the day override the default weekly schedule.
  const staffWindows: Interval[] = shifts.length
    ? shifts.map((s) => ({ start: s.startAt, end: s.endAt }))
    : windowsFromWeeklyHours(date, staff.weeklyHours as WeeklyHours | null);
  // The salon's own opening days and hours always win over an individual's schedule.
  const windows = clampToOpening(date, staffWindows, (settings as { openingHours?: unknown }).openingHours as OpeningHours | null | undefined);

  if (windows.length === 0) return base;

  const asInterval = (r: { startAt: Date; endAt: Date }): Interval => ({ start: r.startAt, end: r.endAt });
  const blocks: Interval[] = [...shifts.flatMap((s) => s.breaks.map(asInterval)), ...timeOffs.map(asInterval)];

  const slots = computeSlots({
    date,
    durationMin: service.durationMin,
    bufferMin: settings.bufferMinutes,
    windows,
    bookings: [...bookings, ...holds].map(asInterval),
    blocks,
    now: new Date(),
    minNoticeHours: opts.publicRules ? settings.minNoticeHours : 0,
  });

  base.isWorking = true;
  base.availableSlots = slots.map((s) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    startAt: s.startAt.toISOString(),
  }));
  return base;
}

/** True when `startAt` is a bookable start time for this staff + service. */
export async function isSlotAvailable(
  branchId: string,
  staffId: string,
  serviceId: string,
  startAt: Date,
  opts: AvailabilityOptions = {},
): Promise<boolean> {
  const date = nairobiDateString(startAt);
  const result = await getAvailableSlots(branchId, { staffId, serviceId, date }, opts);
  return result.availableSlots.some((s) => s.startAt === startAt.toISOString());
}

/** Staff who can perform a service: anyone with no restrictions, or anyone explicitly assigned to it. */
export const qualifiedStaffWhere = (serviceId: string) => ({
  OR: [{ services: { none: {} } }, { services: { some: { serviceId } } }],
});

export async function canPerform(staffId: string, serviceId: string) {
  const found = await prisma.staff.findFirst({ where: { id: staffId, ...qualifiedStaffWhere(serviceId) }, select: { id: true } });
  return Boolean(found);
}

/**
 * Free times across all qualified, bookable staff ("any stylist"). Each slot names the stylist who would take it:
 * of the people free at that time, the one with the fewest appointments that day, so work is shared fairly.
 */
export async function getAnyStaffSlots(branchId: string, serviceId: string, date: string, opts: AvailabilityOptions = {}) {
  const staff = await prisma.staff.findMany({
    where: { branchId, isActive: true, isBookable: true, ...qualifiedStaffWhere(serviceId) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (staff.length === 0) return [];

  const load = new Map<string, number>();
  const counts = await prisma.booking.groupBy({
    by: ["staffId"],
    where: { staffId: { in: staff.map((s) => s.id) }, startAt: { gte: dayStart(date), lt: dayEnd(date) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    _count: { _all: true },
  });
  for (const c of counts) load.set(c.staffId, c._count._all);

  const byTime = new Map<string, { startAt: string; startTime: string; endTime: string; staffId: string; staffName: string }>();
  for (const member of staff) {
    const res = await getAvailableSlots(branchId, { staffId: member.id, serviceId, date }, opts);
    for (const slot of res.availableSlots) {
      const current = byTime.get(slot.startAt);
      if (!current || (load.get(member.id) ?? 0) < (load.get(current.staffId) ?? 0)) {
        byTime.set(slot.startAt, { ...slot, staffId: member.id, staffName: member.name });
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

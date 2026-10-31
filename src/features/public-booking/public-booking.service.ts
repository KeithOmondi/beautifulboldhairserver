import { prisma } from "../../config/db";
import { currentPrice } from "../../utils/money";
import { env, mpesaEnabled } from "../../config/env";
import { AppError } from "../../utils/errors";
import { normalizePhone } from "../../utils/phone";
import { dayEnd, dayStart, nairobiDateString } from "../../utils/time";
import { initiateStkPush, queryStkStatus, isFinalStkFailure } from "../../integrations/mpesa";
import { canPerform, getAnyStaffSlots, qualifiedStaffWhere, getAvailableSlots, isSlotAvailable } from "../availability/availability.service";
import { findOrCreateClient, insertBooking, rescheduleBooking, cancelBooking } from "../booking/booking.service";
import { notifyBookingConfirmed } from "../notification/notify";
import { currentBranchSlug } from "../../utils/branch-context";
import { summarizeOpening, type OpeningHours } from "../../utils/opening-hours";
import type { CreatePublicBookingInput, PublicAvailabilityQuery } from "./public-booking.schema";

/**
 * The branch a public request is about: the one the visitor chose (?branch=slug), otherwise the first active one.
 * An unknown or switched-off branch is a clear 404 rather than silently showing a different side.
 */
export async function getPublicBranch() {
  const slug = currentBranchSlug();
  const branch = await prisma.branch.findFirst({
    where: slug ? { slug, isActive: true } : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { settings: true },
  });
  if (!branch) {
    if (slug) throw new AppError(404, "We couldn't find that branch", "NO_BRANCH");
    throw new AppError(503, "The salon is not accepting bookings right now", "NO_BRANCH");
  }
  return branch;
}

/** A specific branch with its settings, for links that already know their booking (manage, review, order pages). */
export async function getBranchById(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id }, include: { settings: true } });
  if (!branch) throw new AppError(404, "We couldn't find that branch", "NO_BRANCH");
  return branch;
}

/** The branches customers can choose between. */
export async function listPublicBranches() {
  const rows = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { slug: true, name: true, city: true, tagline: true, address: true, phone: true, hoursText: true, settings: { select: { openingHours: true } } },
  });
  return rows.map(({ settings, hoursText, ...b }) => ({ ...b, hours: summarizeOpening(settings?.openingHours as OpeningHours | null) ?? hoursText }));
}

// ─── Catalog ───────────────────────────────────────────────────────────────

export async function getPublicInfo() {
  const branch = await getPublicBranch();
  const s = branch.settings;
  return {
    name: branch.name,
    phone: branch.phone,
    address: branch.address,
    depositRequired: Boolean(s?.depositRequired && (s?.depositAmount ?? 0) > 0 && mpesaEnabled),
    depositAmount: s?.depositAmount ?? 0,
    cancelWindowHours: s?.cancelWindowHours ?? 24,
    showStylists: s?.showStylists ?? false,
    maxAheadDays: s?.maxAheadDays ?? 60,
    minNoticeHours: s?.minNoticeHours ?? 3,
  };
}

export async function getPublicServices() {
  const branch = await getPublicBranch();
  const rows = await prisma.service.findMany({
    where: { branchId: branch.id, isActive: true },
    select: { id: true, name: true, description: true, durationMin: true, price: true, salePrice: true, category: true, imageUrl: true, requiresPatchTest: true },
    orderBy: [{ price: "asc" }, { name: "asc" }],
  });
  // `price` is what the client pays today; `wasPrice` is the normal price, present only while an offer runs.
  return rows.map(({ salePrice, ...r }) => {
    const today = currentPrice({ price: r.price, salePrice });
    return { ...r, price: today, wasPrice: today < r.price ? r.price : null };
  });
}

export async function getPublicStaff(serviceId?: string) {
  const branch = await getPublicBranch();
  // Names are only published when the salon lets clients choose their stylist.
  if (!branch.settings?.showStylists) return [];
  return prisma.staff.findMany({
    where: { branchId: branch.id, isActive: true, isBookable: true, ...(serviceId ? qualifiedStaffWhere(serviceId) : {}) },
    select: { id: true, name: true, title: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPublicAvailability(q: PublicAvailabilityQuery) {
  const branch = await getPublicBranch();
  if (!q.staffId || q.staffId === "any") {
    const slots = await getAnyStaffSlots(branch.id, q.serviceId, q.date, { publicRules: true });
    return { date: q.date, slots: slots.map((s) => ({ startAt: s.startAt, startTime: s.startTime, endTime: s.endTime })) };
  }
  const res = await getAvailableSlots(branch.id, { staffId: q.staffId, serviceId: q.serviceId, date: q.date }, { publicRules: true });
  return {
    date: q.date,
    slots: res.availableSlots.map((s) => ({ startAt: s.startAt, startTime: s.startTime, endTime: s.endTime })),
  };
}

// ─── Booking + deposit ─────────────────────────────────────────────────────

const holdPublicView = (hold: { id: string; status: string; expiresAt: Date; depositAmount: number }) => ({
  holdId: hold.id,
  status: hold.status,
  expiresAt: hold.expiresAt,
  depositAmount: hold.depositAmount,
});

export async function createPublicBooking(input: CreatePublicBookingInput) {
  const branch = await getPublicBranch();
  const settings = branch.settings;
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError(400, "Invalid phone number", "INVALID_PHONE");

  const startAt = new Date(input.startAt);
  const service = await prisma.service.findFirst({ where: { id: input.serviceId, branchId: branch.id, isActive: true } });
  if (!service) throw new AppError(404, "Service not found", "NOT_FOUND");

  // Resolve "any stylist" to a concrete one who is free at this exact time.
  let staffId = input.staffId && input.staffId !== "any" ? input.staffId : null;
  if (!staffId) {
    const slots = await getAnyStaffSlots(branch.id, service.id, nairobiDateString(startAt), { publicRules: true });
    staffId = slots.find((s) => s.startAt === startAt.toISOString())?.staffId ?? null;
    if (!staffId) throw new AppError(409, "That time is no longer available. Please pick another.", "SLOT_TAKEN");
  }
  const staff = await prisma.staff.findFirst({ where: { id: staffId, branchId: branch.id, isActive: true, isBookable: true } });
  if (!staff || !(await canPerform(staffId, service.id))) throw new AppError(404, "Stylist not found", "NOT_FOUND");

  const existingClient = await prisma.client.findUnique({ where: { branchId_phone: { branchId: branch.id, phone } } });
  if (existingClient?.isBlocked) throw new AppError(403, "We can't take this booking online. Please call the salon.", "CLIENT_BLOCKED");

  // Limit how much one phone number can book per day (stops slot-hoarding).
  const date = nairobiDateString(startAt);
  const maxPerDay = settings?.maxBookingsPerDay ?? 2;
  const [bookedToday, holdsToday] = await Promise.all([
    prisma.booking.count({
      where: { client: { phone }, startAt: { gte: dayStart(date), lt: dayEnd(date) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    }),
    prisma.slotHold.count({
      where: { clientPhone: phone, status: "PENDING", expiresAt: { gt: new Date() }, startAt: { gte: dayStart(date), lt: dayEnd(date) } },
    }),
  ]);
  if (bookedToday + holdsToday >= maxPerDay) {
    throw new AppError(409, `You already have ${maxPerDay} booking(s) that day. Please choose another day.`, "LIMIT_REACHED");
  }

  const wantsDeposit = Boolean(settings?.depositRequired && (settings?.depositAmount ?? 0) > 0);
  const depositAmount = wantsDeposit ? Math.min(settings!.depositAmount, currentPrice(service)) : 0;
  if (depositAmount > 0 && !mpesaEnabled) {
    throw new AppError(503, "Online deposits are temporarily unavailable. Please call the salon to book.", "PAYMENTS_UNAVAILABLE");
  }

  // Serialise per stylist so two people can't grab the same slot between check and insert.
  const hold = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${staffId}))`;

    const ok = await isSlotAvailable(branch.id, staffId!, service.id, startAt, { publicRules: true });
    if (!ok) throw new AppError(409, "That time was just taken. Please pick another.", "SLOT_TAKEN");

    return tx.slotHold.create({
      data: {
        branchId: branch.id,
        staffId: staffId!,
        serviceId: service.id,
        startAt,
        endAt: new Date(startAt.getTime() + service.durationMin * 60_000),
        clientPhone: phone,
        clientName: input.name,
        clientAllergies: input.allergies ?? null,
        depositAmount,
        expiresAt: new Date(Date.now() + env.SLOT_HOLD_MINUTES * 60_000),
      },
    });
  });

  // No deposit needed: confirm straight away.
  if (depositAmount === 0) {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const client = await findOrCreateClient(tx, branch.id, { phone, name: input.name, allergies: input.allergies ?? null });
        const created = await insertBooking(tx, {
          branchId: branch.id,
          clientId: client.id,
          staffId: staffId!,
          serviceId: service.id,
          startAt,
          source: "ONLINE",
          allergies: client.allergies,
        });
        await tx.slotHold.update({ where: { id: hold.id }, data: { status: "PAID", bookingId: created.id } });
        return created;
      });
      void notifyBookingConfirmed(booking.id);
      return { ...holdPublicView({ ...hold, status: "PAID" }), requiresPayment: false, manageToken: booking.manageToken };
    } catch (error) {
      await prisma.slotHold.delete({ where: { id: hold.id } }).catch(() => {});
      throw error;
    }
  }

  const stk = await initiateStkPush({
    phone,
    amount: depositAmount,
    accountReference: hold.id.slice(-10),
    description: "Deposit",
  });
  if (!stk.success) {
    await prisma.slotHold.delete({ where: { id: hold.id } }).catch(() => {});
    const detail = env.NODE_ENV === "production" ? "" : ` [dev: ${stk.error}]`;
    throw new AppError(502, `We could not start the M-Pesa payment. Check your number and try again.${detail}`, "MPESA_FAILED");
  }
  await prisma.slotHold.update({ where: { id: hold.id }, data: { mpesaCheckoutId: stk.checkoutRequestId } });

  return { ...holdPublicView(hold), requiresPayment: true, message: "Check your phone and enter your M-Pesa PIN." };
}

/** Polled by the booking page while the client approves the M-Pesa prompt. */
export async function getHoldStatus(holdId: string) {
  let hold = await prisma.slotHold.findUnique({ where: { id: holdId } });
  if (!hold) throw new AppError(404, "Booking request not found", "NOT_FOUND");

  if (hold.status === "PENDING" && hold.expiresAt <= new Date()) {
    hold = await prisma.slotHold.update({ where: { id: hold.id }, data: { status: "EXPIRED" } });
  }

  // If the callback is late, ask Safaricom directly so a cancelled prompt frees the slot quickly.
  if (hold.status === "PENDING" && hold.mpesaCheckoutId && Date.now() - hold.createdAt.getTime() > 25_000) {
    const q = await queryStkStatus(hold.mpesaCheckoutId);
    if (q.success && isFinalStkFailure(q.resultCode)) {
      hold = await prisma.slotHold.update({
        where: { id: hold.id },
        data: { status: "FAILED", failureReason: q.resultDesc.slice(0, 200) },
      });
    }
  }

  const booking = hold.bookingId
    ? await prisma.booking.findUnique({
        where: { id: hold.bookingId },
        select: { manageToken: true, startAt: true, service: { select: { name: true } }, staff: { select: { name: true } } },
      })
    : null;

  return {
    status: hold.status,
    failureReason: hold.status === "FAILED" ? "The M-Pesa payment was not completed." : null,
    booking: booking
      ? { manageToken: booking.manageToken, startAt: booking.startAt, serviceName: booking.service.name, staffName: booking.staff.name }
      : null,
  };
}

// ─── Manage my booking (by secret link) ────────────────────────────────────

async function bookingByToken(token: string) {
  const booking = await prisma.booking.findUnique({
    where: { manageToken: token },
    include: { client: { select: { name: true } }, service: { select: { name: true, durationMin: true, price: true } }, staff: { select: { id: true, name: true } } },
  });
  if (!booking) throw new AppError(404, "We couldn't find that booking", "NOT_FOUND");
  return booking;
}

export async function getManagedBooking(token: string) {
  const booking = await bookingByToken(token);
  const branch = await getBranchById(booking.branchId);
  const windowHours = branch.settings?.cancelWindowHours ?? 24;
  const hoursAway = (booking.startAt.getTime() - Date.now()) / 3_600_000;
  const open = booking.status === "CONFIRMED" || booking.status === "PENDING";

  return {
    salon: { name: branch.name, phone: branch.phone, address: branch.address },
    clientName: booking.client.name,
    serviceId: booking.serviceId,
    serviceName: booking.service.name,
    staffId: booking.staff.id,
    staffName: booking.staff.name,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    price: booking.price,
    depositPaid: booking.depositPaid,
    cancelWindowHours: windowHours,
    isUpcoming: hoursAway > 0 && open,
    canReschedule: open && hoursAway >= windowHours,
    // Cancelling inside the window is allowed, but the deposit is kept.
    cancellationKeepsDeposit: open && hoursAway < windowHours && booking.depositPaid > 0,
  };
}

export async function cancelManagedBooking(token: string) {
  const booking = await bookingByToken(token);
  const branch = await getBranchById(booking.branchId);
  const windowHours = branch.settings?.cancelWindowHours ?? 24;
  if (booking.startAt.getTime() <= Date.now()) throw new AppError(400, "This appointment has already started", "BAD_REQUEST");
  const late = (booking.startAt.getTime() - Date.now()) / 3_600_000 < windowHours;
  await cancelBooking(booking.branchId, booking.id, { keepDeposit: late });
  return getManagedBooking(token);
}

export async function rescheduleManagedBooking(token: string, newStartAt: string) {
  const booking = await bookingByToken(token);
  const view = await getManagedBooking(token);
  if (!view.canReschedule) {
    throw new AppError(400, `Appointments can be moved up to ${view.cancelWindowHours} hours before. Please call the salon.`, "TOO_LATE");
  }
  await rescheduleBooking(booking.branchId, booking.id, { newStartAt }, { publicRules: true });
  return getManagedBooking(token);
}

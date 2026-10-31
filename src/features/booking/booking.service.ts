import { randomBytes } from "node:crypto";
import { currentPrice } from "../../utils/money";
import { prisma } from "../../config/db";
import type { Prisma } from "../../generated/prisma/client";
import { AppError } from "../../utils/errors";
import { normalizePhone } from "../../utils/phone";
import { dayEnd, dayStart } from "../../utils/time";
import { isSlotAvailable } from "../availability/availability.service";
import { notifyBookingCancelled, notifyBookingConfirmed, notifyBookingRescheduled } from "../notification/notify";
import type { CheckoutDto, CreateBookingDto, RescheduleBookingDto } from "./booking.schema";

type Db = Prisma.TransactionClient | typeof prisma;

const isOverlapError = (error: any) =>
  error?.code === "23P01" ||
  error?.cause?.code === "23P01" ||
  String(error?.message ?? "").includes("Booking_no_overlap");

export const newManageToken = () => randomBytes(24).toString("hex");

/** Finds a client of this branch by phone, creating one if needed (carrying allergy notes over from other branches). */
export async function findOrCreateClient(
  db: Db,
  branchId: string,
  input: { phone: string; name: string; allergies?: string | null },
) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");

  const existing = await db.client.findUnique({ where: { branchId_phone: { branchId, phone } } });
  if (existing) {
    if (existing.isBlocked) throw new AppError(403, "This client cannot make bookings. Please contact the salon.", "CLIENT_BLOCKED");
    if (input.allergies && input.allergies !== existing.allergies) {
      return db.client.update({ where: { id: existing.id }, data: { allergies: input.allergies } });
    }
    return existing;
  }
  // Allergy notes matter for safety, so a customer who has visited another branch brings them along.
  const elsewhere = await db.client.findFirst({ where: { phone, branchId: { not: branchId } }, orderBy: { updatedAt: "desc" }, select: { allergies: true } });
  return db.client.create({
    data: { branchId, phone, name: input.name, allergies: input.allergies ?? elsewhere?.allergies ?? null, ...(elsewhere ? { isFirstLash: false } : {}) },
  });
}

/** Single place that writes a booking row and converts the DB's double-booking guard into a friendly error. */
export async function insertBooking(
  db: Db,
  args: {
    branchId: string;
    clientId: string;
    staffId: string;
    serviceId: string;
    startAt: Date;
    source: "WALKIN" | "ONLINE" | "PHONE";
    discount?: number;
    depositPaid?: number;
    notes?: string | null;
    allergies?: string | null;
  },
) {
  const service = await db.service.findFirst({
    where: { id: args.serviceId, branchId: args.branchId, isActive: true },
  });
  if (!service) throw new AppError(404, "Service not found or inactive", "NOT_FOUND");

  const today = currentPrice(service);
  const discount = Math.min(args.discount ?? 0, today);
  const endAt = new Date(args.startAt.getTime() + service.durationMin * 60_000);

  try {
    return await db.booking.create({
      data: {
        branchId: args.branchId,
        clientId: args.clientId,
        staffId: args.staffId,
        serviceId: args.serviceId,
        startAt: args.startAt,
        endAt,
        status: "CONFIRMED",
        source: args.source,
        price: today,
        discount,
        depositPaid: args.depositPaid ?? 0,
        manageToken: newManageToken(),
        notes: args.notes ?? null,
        allergies: args.allergies ?? null,
      },
    });
  } catch (error: any) {
    if (isOverlapError(error)) throw new AppError(409, "That time slot is no longer available", "SLOT_TAKEN");
    throw error;
  }
}

const bookingInclude = {
  client: { select: { id: true, name: true, phone: true, allergies: true } },
  staff: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, durationMin: true } },
  payments: { select: { id: true, amount: true, method: true, kind: true, mpesaReceipt: true, createdAt: true } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Adds money fields the UI needs everywhere: what has been paid, and what is still owed. */
export function withBalance(b: BookingWithRelations) {
  const paidTotal = b.payments.reduce((sum, p) => sum + p.amount, 0);
  const due = Math.max(0, b.price - b.discount);
  return { ...b, paidTotal, amountDue: due, balance: Math.max(0, due - paidTotal) };
}

export async function createBooking(branchId: string, data: CreateBookingDto, actorId?: string) {
  const startAt = new Date(data.startAt);

  const staff = await prisma.staff.findFirst({ where: { id: data.staffId, branchId, isActive: true } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  const available = await isSlotAvailable(branchId, data.staffId, data.serviceId, startAt);
  if (!available) throw new AppError(409, "That time slot is not available for this stylist", "SLOT_TAKEN");

  const booking = await prisma.$transaction(async (tx) => {
    let clientId = data.clientId;
    let allergies: string | null = null;

    if (clientId) {
      const client = await tx.client.findFirst({ where: { id: clientId, branchId } });
      if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
      if (client.isBlocked) throw new AppError(403, "This client is blocked", "CLIENT_BLOCKED");
      allergies = client.allergies;
    } else {
      const client = await findOrCreateClient(tx, branchId, { phone: data.clientPhone!, name: data.clientName! });
      clientId = client.id;
      allergies = client.allergies;
    }

    return insertBooking(tx, {
      branchId,
      clientId,
      staffId: data.staffId,
      serviceId: data.serviceId,
      startAt,
      source: data.source,
      discount: data.discount,
      notes: data.notes ?? null,
      allergies,
    });
  });

  if (actorId) {
    await prisma.auditLog
      .create({ data: { action: "CREATE", entity: "Booking", entityId: booking.id, branchId, actorId } })
      .catch(() => {});
  }
  void notifyBookingConfirmed(booking.id);
  return getBooking(branchId, booking.id);
}

export async function listBookings(
  branchId: string,
  filter: { date?: string | undefined; from?: string | undefined; to?: string | undefined; staffId?: string | undefined; clientId?: string | undefined; status?: string | undefined },
) {
  const where: Prisma.BookingWhereInput = { branchId };

  if (filter.date) {
    where.startAt = { gte: dayStart(filter.date), lt: dayEnd(filter.date) };
  } else if (filter.from || filter.to) {
    where.startAt = {
      ...(filter.from ? { gte: dayStart(filter.from) } : {}),
      ...(filter.to ? { lt: dayEnd(filter.to) } : {}),
    };
  }
  if (filter.staffId) where.staffId = filter.staffId;
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.status) where.status = filter.status as any;

  const rows = await prisma.booking.findMany({
    where,
    include: bookingInclude,
    orderBy: { startAt: "asc" },
    take: 500,
  });
  return rows.map(withBalance);
}

export async function getBooking(branchId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, branchId }, include: bookingInclude });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  return withBalance(booking);
}

export async function setStatus(branchId: string, bookingId: string, status: "CONFIRMED" | "COMPLETED" | "NO_SHOW", actorId?: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, branchId } });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED") throw new AppError(400, "A cancelled booking cannot be changed", "BAD_REQUEST");
  if (booking.status === "COMPLETED" && status !== "COMPLETED") {
    throw new AppError(400, "A completed booking cannot be changed", "BAD_REQUEST");
  }

  try {
    await prisma.booking.update({ where: { id: bookingId }, data: { status } });
  } catch (error) {
    // Re-confirming a no-show can collide with a booking that took the freed slot.
    if (isOverlapError(error)) throw new AppError(409, "That time has since been booked by someone else", "SLOT_TAKEN");
    throw error;
  }
  await prisma.auditLog
    .create({ data: { action: "BOOKING_STATUS", entity: "Booking", entityId: bookingId, branchId, before: { status: booking.status }, after: { status }, ...(actorId ? { actorId } : {}) } })
    .catch(() => {});
  return getBooking(branchId, bookingId);
}

/**
 * Collects the remaining balance, records the payment and completes the booking in one transaction.
 */
export async function checkout(branchId: string, bookingId: string, data: CheckoutDto, actorId?: string) {
  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({ where: { id: bookingId, branchId }, include: { payments: true } });
    if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
    if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
      throw new AppError(400, "This booking was cancelled or marked no-show", "BAD_REQUEST");
    }

    const discount = Math.min(data.discount ?? booking.discount, booking.price);
    const due = booking.price - discount;
    const alreadyPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = Math.max(0, due - alreadyPaid);
    const amount = data.amount ?? balance;

    if (amount > balance) {
      throw new AppError(400, `Amount is more than the balance of KES ${balance.toLocaleString()}`, "OVERPAYMENT");
    }

    if (discount !== booking.discount) {
      await tx.auditLog.create({
        data: {
          action: "DISCOUNT",
          entity: "Booking",
          entityId: bookingId,
          branchId,
          before: { discount: booking.discount },
          after: { discount },
          ...(actorId ? { actorId } : {}),
        },
      });
    }

    if (amount > 0) {
      if (data.mpesaReceipt) {
        const dup = await tx.payment.findUnique({ where: { mpesaReceipt: data.mpesaReceipt } });
        if (dup) throw new AppError(409, "That M-Pesa code has already been used", "DUPLICATE_RECEIPT");
      }
      await tx.payment.create({
        data: {
          branchId,
          bookingId,
          amount,
          method: data.method,
          kind: "BALANCE",
          mpesaReceipt: data.method === "MPESA" ? (data.mpesaReceipt ?? null) : null,
          notes: data.notes ?? null,
          recordedBy: actorId ?? null,
        },
      });
    }

    const fullyPaid = alreadyPaid + amount >= due;
    await tx.booking.update({
      where: { id: bookingId },
      data: { discount, paid: fullyPaid, status: fullyPaid ? "COMPLETED" : booking.status },
    });
  });

  return getBooking(branchId, bookingId);
}

export async function cancelBooking(branchId: string, bookingId: string, opts: { keepDeposit?: boolean } = {}, actorId?: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, branchId } });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED") throw new AppError(400, "Booking is already cancelled", "BAD_REQUEST");
  if (booking.status === "COMPLETED") throw new AppError(400, "A completed booking cannot be cancelled", "BAD_REQUEST");

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      depositRefundDue: booking.depositPaid > 0 && !opts.keepDeposit,
    },
  });
  await prisma.auditLog
    .create({ data: { action: "BOOKING_STATUS", entity: "Booking", entityId: bookingId, branchId, before: { status: booking.status }, after: { status: "CANCELLED" }, ...(actorId ? { actorId } : {}) } })
    .catch(() => {});
  void notifyBookingCancelled(bookingId);
  return getBooking(branchId, bookingId);
}

export async function rescheduleBooking(
  branchId: string,
  bookingId: string,
  data: RescheduleBookingDto,
  opts: { publicRules?: boolean } = {},
) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, branchId } });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED" || booking.status === "NO_SHOW") {
    throw new AppError(400, "This booking can no longer be moved", "BAD_REQUEST");
  }

  const staffId = data.staffId ?? booking.staffId;
  const newStart = new Date(data.newStartAt);

  const available = await isSlotAvailable(branchId, staffId, booking.serviceId, newStart, {
    excludeBookingId: bookingId,
    ...(opts.publicRules ? { publicRules: true } : {}),
  });
  if (!available) throw new AppError(409, "The new time is not available", "SLOT_TAKEN");

  const service = await prisma.service.findUniqueOrThrow({ where: { id: booking.serviceId } });
  try {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        startAt: newStart,
        endAt: new Date(newStart.getTime() + service.durationMin * 60_000),
        staffId,
        reminderSentAt: null,
      },
    });
  } catch (error) {
    if (isOverlapError(error)) throw new AppError(409, "The new time is not available", "SLOT_TAKEN");
    throw error;
  }
  void notifyBookingRescheduled(bookingId);
  return getBooking(branchId, bookingId);
}

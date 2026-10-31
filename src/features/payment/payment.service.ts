import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { dayEnd, dayStart } from "../../utils/time";
import type { CreatePaymentDto } from "./payment.schema";

/**
 * Manual payment entry (e.g. a deposit paid at the till, or a payment not tied to a booking).
 * For taking the balance at the end of an appointment, use the booking checkout instead.
 */
export async function createPayment(branchId: string, data: CreatePaymentDto, actorId?: string) {
  return prisma.$transaction(async (tx) => {
    const booking = data.bookingId
      ? await tx.booking.findFirst({ where: { id: data.bookingId, branchId }, include: { payments: true } })
      : null;
    if (data.bookingId && !booking) throw new AppError(404, "Booking not found", "NOT_FOUND");

    if (booking && data.kind !== "REFUND") {
      const totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
      const balanceDue = booking.price - booking.discount - totalPaid;
      if (data.amount > balanceDue) {
        throw new AppError(400, `Payment exceeds balance due. Balance is KES ${balanceDue}`, "OVERPAYMENT");
      }
    }

    if (data.mpesaReceipt) {
      const dup = await tx.payment.findUnique({ where: { mpesaReceipt: data.mpesaReceipt } });
      if (dup) throw new AppError(409, "This M-Pesa receipt has already been recorded", "DUPLICATE_RECEIPT");
    }

    const payment = await tx.payment.create({
      data: {
        branchId,
        bookingId: data.bookingId ?? null,
        amount: data.amount,
        method: data.method,
        kind: data.kind,
        mpesaReceipt: data.mpesaReceipt ?? null,
        mpesaPhone: data.mpesaPhone ?? null,
        notes: data.notes ?? null,
        recordedBy: actorId ?? null,
      },
    });

    let summary;
    if (booking) {
      const totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0) + data.amount;
      const due = booking.price - booking.discount;
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          paid: totalPaid >= due,
          ...(data.kind === "DEPOSIT" ? { depositPaid: booking.depositPaid + data.amount } : {}),
        },
      });
      summary = { id: booking.id, totalPrice: due, totalPaid, balanceDue: Math.max(0, due - totalPaid) };
    }

    return { paymentId: payment.id, amount: payment.amount, method: payment.method, kind: payment.kind, booking: summary };
  });
}

export async function listPayments(branchId: string, dateString?: string) {
  return prisma.payment.findMany({
    where: {
      branchId,
      ...(dateString ? { createdAt: { gte: dayStart(dateString), lt: dayEnd(dateString) } } : {}),
    },
    include: {
      booking: {
        select: {
          id: true,
          price: true,
          discount: true,
          client: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/**
 * Records a refund (a negative payment). A payment can only be refunded once.
 * Money is returned to the client outside the system (M-Pesa/cash); this keeps the books honest.
 */
export async function refundPayment(branchId: string, paymentId: string, actorId?: string) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.payment.findFirst({ where: { id: paymentId, branchId } });
    if (!original) throw new AppError(404, "Payment not found", "NOT_FOUND");
    if (original.kind === "REFUND") throw new AppError(400, "Cannot refund a refund", "BAD_REQUEST");

    const already = await tx.payment.findFirst({ where: { kind: "REFUND", notes: { contains: original.id } } });
    if (already) throw new AppError(409, "This payment has already been refunded", "ALREADY_REFUNDED");

    const refund = await tx.payment.create({
      data: {
        branchId,
        bookingId: original.bookingId,
        amount: -Math.abs(original.amount),
        method: original.method,
        kind: "REFUND",
        notes: `Refund for payment ${original.id}`,
        recordedBy: actorId ?? null,
      },
    });

    if (original.bookingId) {
      const booking = await tx.booking.findUnique({ where: { id: original.bookingId }, include: { payments: true } });
      if (booking) {
        const totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paid: totalPaid >= booking.price - booking.discount,
            ...(original.kind === "DEPOSIT" ? { depositPaid: Math.max(0, booking.depositPaid - original.amount), depositRefundDue: false } : {}),
          },
        });
      }
    }

    await tx.auditLog.create({
      data: { action: "REFUND", entity: "Payment", entityId: original.id, branchId, after: { refundId: refund.id, amount: original.amount }, ...(actorId ? { actorId } : {}) },
    });

    return { message: "Refund recorded", refundId: refund.id };
  });
}

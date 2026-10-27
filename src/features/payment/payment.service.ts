import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { CreatePaymentDto } from "./payment.schema";
//import { recordAudit } from "../../utils/audit";

export async function createPayment(branchId: string, data: CreatePaymentDto) {
  let booking: any = null;

  // 1. If a bookingId is provided, verify it exists and belongs to this branch
  if (data.bookingId) {
    booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, branchId },
      include: { payments: true },
    });

    if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");

    // Check if the booking is already fully paid
    const totalPaid = booking.payments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const balanceDue = booking.price - totalPaid;

    if (data.kind !== "REFUND" && data.amount > balanceDue) {
      throw new AppError(400, `Payment exceeds balance due. Balance is ${balanceDue} KES`, "OVERPAYMENT");
    }
  }

  // 2. Check for duplicate M-Pesa receipt
  if (data.mpesaReceipt) {
    const existingReceipt = await prisma.payment.findUnique({
      where: { mpesaReceipt: data.mpesaReceipt },
    });
    if (existingReceipt) {
      throw new AppError(409, "This M-Pesa receipt has already been recorded", "DUPLICATE_RECEIPT");
    }
  }

  // 3. Create the payment record
  const payment = await prisma.payment.create({
    data: {
      branchId,
      bookingId: data.bookingId ?? null,
      amount: data.amount,
      method: data.method,
      kind: data.kind,
      mpesaReceipt: data.mpesaReceipt ?? null,
      mpesaPhone: data.mpesaPhone ?? null,
      notes: data.notes ?? null,
      recordedBy: null, // We can add req.user.sub later if needed
    },
  });

  // 4. If linked to a booking, calculate the new balance and return it
  let bookingSummary = undefined;
  if (booking) {
    const newTotalPaid = booking.payments.reduce((sum: number, p: any) => sum + p.amount, 0) + data.amount;
    const newBalance = booking.price - newTotalPaid;

    bookingSummary = {
      id: booking.id,
      totalPrice: booking.price,
      totalPaid: newTotalPaid,
      balanceDue: newBalance,
    };

    // If the booking is fully paid, mark it as paid
    if (newBalance <= 0) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { paid: true, depositPaid: booking.depositPaid + data.amount },
      });
    } else if (data.kind === "DEPOSIT") {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { depositPaid: booking.depositPaid + data.amount },
      });
    }
  }

  return {
    paymentId: payment.id,
    amount: payment.amount,
    method: payment.method,
    kind: payment.kind,
    mpesaReceipt: payment.mpesaReceipt,
    createdAt: payment.createdAt,
    booking: bookingSummary,
  };
}

/**
 * Lists all payments for a specific branch on a given date.
 */
export async function listPayments(branchId: string, dateString?: string) {
  const whereClause: any = { branchId };

  if (dateString) {
    const dayStart = new Date(`${dateString}T00:00:00+03:00`);
    const dayEnd = new Date(`${dateString}T23:59:59+03:00`);
    whereClause.createdAt = { gte: dayStart, lte: dayEnd };
  }

  return prisma.payment.findMany({
    where: whereClause,
    include: {
      booking: {
        include: {
          client: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Processes a refund for a payment.
 */
export async function refundPayment(branchId: string, paymentId: string) {
  const originalPayment = await prisma.payment.findFirst({
    where: { id: paymentId, branchId },
  });

  if (!originalPayment) throw new AppError(404, "Payment not found", "NOT_FOUND");
  if (originalPayment.kind === "REFUND") throw new AppError(400, "Cannot refund a refund", "BAD_REQUEST");

  // Create a negative payment entry (refund)
  const refund = await prisma.payment.create({
    data: {
      branchId,
      bookingId: originalPayment.bookingId,
      amount: -Math.abs(originalPayment.amount), // Force negative amount
      method: originalPayment.method,
      kind: "REFUND",
      notes: `Refund for payment ${originalPayment.id}`,
    },
  });

  // If it was tied to a booking, recalculate the balance
  if (originalPayment.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: originalPayment.bookingId },
      include: { payments: true },
    });

    if (booking) {
      const totalPaid = booking.payments.reduce((sum, p) => sum + p.amount, 0);
      const newBalance = booking.price - totalPaid;

      await prisma.booking.update({
        where: { id: booking.id },
        data: { paid: newBalance <= 0 },
      });
    }
  }

  return { message: "Refund processed successfully", refundId: refund.id };
}
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";

interface C2BCallbackBody {
  TransID: string;      // M-Pesa Receipt (e.g., "QJ12345678")
  TransAmount: string;  // Amount as a string (e.g., "3500.00")
  BusinessShortCode: string;
  BillRefNumber: string; // The Account Reference the customer typed
  MSISDN: string;        // Customer phone (e.g., "254722222222")
  FirstName?: string;
  TransTime: string;
}

export async function handleC2BCallback(branchId: string, payload: C2BCallbackBody) {
  const receipt = payload.TransID;
  const amount = Math.round(parseFloat(payload.TransAmount));
  const phone = `+${payload.MSISDN}`;
  const accountRef = payload.BillRefNumber?.trim() || null;

  // 1. Idempotency: If we've already seen this receipt, accept and exit.
  const existing = await prisma.pendingPayment.findUnique({
    where: { mpesaReceipt: receipt },
  });

  if (existing) {
    return { ResultCode: 0, ResultDesc: "Accepted" };
  }

  // 2. Try to auto-match to an existing booking if the accountRef looks like a booking ID
  let matchedBookingId: string | null = null;
  
  if (accountRef) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: { startsWith: accountRef }, // If customer typed the short booking ID
        branchId,
        paid: false,
      },
    });
    if (booking) {
      matchedBookingId = booking.id;
    }
  }

  // 3. Save the pending payment
  const pending = await prisma.pendingPayment.create({
    data: {
      branchId,
      amount,
      mpesaReceipt: receipt,
      phone,
      accountRef,
      isAssigned: matchedBookingId !== null,
      bookingId: matchedBookingId,
    },
  });

  // 4. If it was matched, immediately record it as a real Payment and mark booking as paid
  if (matchedBookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: matchedBookingId } });
    
    if (booking) {
      await prisma.payment.create({
        data: {
          branchId,
          bookingId: matchedBookingId,
          amount,
          method: "MPESA",
          kind: "BALANCE",
          mpesaReceipt: receipt,
          mpesaPhone: phone,
          notes: `Auto-matched from C2B (Ref: ${accountRef})`,
        },
      });

      // Check if the booking is now fully paid
      const allPayments = await prisma.payment.findMany({
        where: { bookingId: matchedBookingId },
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
      
      if (totalPaid >= booking.price) {
        await prisma.booking.update({
          where: { id: matchedBookingId },
          data: { paid: true },
        });
      }
    }
  }

  return { ResultCode: 0, ResultDesc: "Accepted" };
}

/**
 * List all unassigned pending payments (for the receptionist to review).
 */
export async function listPendingPayments(branchId: string) {
  return prisma.pendingPayment.findMany({
    where: { branchId, isAssigned: false },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Manually assign an unassigned pending payment to a specific booking.
 */
export async function assignPendingPayment(branchId: string, pendingId: string, bookingId: string) {
  const pending = await prisma.pendingPayment.findFirst({
    where: { id: pendingId, branchId, isAssigned: false },
  });
  if (!pending) throw new AppError(404, "Pending payment not found or already assigned", "NOT_FOUND");

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, branchId },
  });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");

  // Use a transaction to keep things consistent
  return prisma.$transaction(async (tx) => {
    // Create the real Payment
    await tx.payment.create({
      data: {
        branchId,
        bookingId,
        amount: pending.amount,
        method: "MPESA",
        kind: "BALANCE",
        mpesaReceipt: pending.mpesaReceipt,
        mpesaPhone: pending.phone,
        notes: `Manually assigned by receptionist`,
      },
    });

    // Update the booking's paid status
    const allPayments = await tx.payment.findMany({ where: { bookingId } });
    const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
    
    if (totalPaid >= booking.price) {
      await tx.booking.update({
        where: { id: bookingId },
        data: { paid: true },
      });
    }

    // Mark the pending payment as assigned
    await tx.pendingPayment.update({
      where: { id: pendingId },
      data: { isAssigned: true, bookingId },
    });

    return { message: "Payment assigned successfully" };
  });
}
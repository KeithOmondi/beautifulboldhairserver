import { mpesaEnabled } from "../../config/env";
import { prisma } from "../../config/db";
import { initiateStkPush, queryStkStatus, isFinalStkFailure } from "../../integrations/mpesa";
import { AppError } from "../../utils/errors";
import { normalizePhone } from "../../utils/phone";

/**
 * "Prompt the client to pay what they still owe": sends an M-Pesa prompt for the booking's balance to the
 * client's phone. The money is recorded by the M-Pesa callback (see mpesa-callback.service), never by this call.
 */
export async function requestBalancePayment(branchId: string, bookingId: string, input: { phone?: string | undefined; amount?: number | undefined }, actorId?: string) {
  if (!mpesaEnabled) {
    throw new AppError(400, "M-Pesa is not set up yet. Take the payment as cash, or add the M-Pesa keys in the server settings.", "MPESA_NOT_CONFIGURED");
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, branchId },
    include: { payments: { select: { amount: true } }, client: { select: { phone: true } } },
  });
  if (!booking) throw new AppError(404, "Booking not found", "NOT_FOUND");
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") {
    throw new AppError(400, "This booking was cancelled or marked no-show", "BAD_REQUEST");
  }

  const balance = Math.max(0, booking.price - booking.discount - booking.payments.reduce((s, p) => s + p.amount, 0));
  if (balance <= 0) throw new AppError(400, "Nothing left to pay on this booking", "NOTHING_DUE");

  const amount = input.amount ?? balance;
  if (amount < 1 || amount > balance) throw new AppError(400, `Enter an amount between KES 1 and KES ${balance.toLocaleString("en-KE")}`, "BAD_REQUEST");

  const phone = normalizePhone(input.phone?.trim() || booking.client.phone);
  if (!phone) throw new AppError(400, "That phone number doesn't look right. Use a Safaricom number like 0712 345 678.", "BAD_REQUEST");

  // One prompt at a time: a second prompt while the first is open confuses clients and risks paying twice.
  const open = await prisma.paymentRequest.findFirst({ where: { bookingId, status: "PENDING", createdAt: { gt: new Date(Date.now() - 90_000) } } });
  if (open) throw new AppError(409, "A payment request was just sent. Give the client a minute to respond.", "REQUEST_IN_PROGRESS");

  const request = await prisma.paymentRequest.create({ data: { branchId, bookingId, amount, phone, requestedBy: actorId ?? null } });
  const stk = await initiateStkPush({ phone, amount, accountReference: `BK${booking.id.slice(-8).toUpperCase()}`, description: "Balance" });
  if (!stk.success) {
    await prisma.paymentRequest.update({ where: { id: request.id }, data: { status: "FAILED", failureReason: stk.error.slice(0, 200) } });
    throw new AppError(502, "We could not send the M-Pesa request. Check the phone number and try again.", "MPESA_FAILED");
  }
  await prisma.paymentRequest.update({ where: { id: request.id }, data: { mpesaCheckoutId: stk.checkoutRequestId } });
  return { id: request.id, status: "PENDING", amount, phone };
}

/** Polled by the booking dialog while the client approves the prompt. */
export async function getPaymentRequest(branchId: string, requestId: string) {
  let r = await prisma.paymentRequest.findFirst({ where: { id: requestId, branchId } });
  if (!r) throw new AppError(404, "Payment request not found", "NOT_FOUND");

  if (r.status === "PENDING") {
    const age = Date.now() - r.createdAt.getTime();
    if (age > 3 * 60_000) {
      // Only the dialog stops waiting. If the client still pays later, the callback records it.
      r = await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", failureReason: "No response from the client" } });
    } else if (r.mpesaCheckoutId && age > 25_000) {
      const q = await queryStkStatus(r.mpesaCheckoutId);
      if (q.success && isFinalStkFailure(q.resultCode)) {
        r = await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "FAILED", failureReason: q.resultDesc.slice(0, 200) } });
      }
    }
  }
  return { id: r.id, status: r.status, amount: r.amount, phone: r.phone };
}

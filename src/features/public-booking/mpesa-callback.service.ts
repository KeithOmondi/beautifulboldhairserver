import { prisma } from "../../config/db";
import { sendSms } from "../../integrations/sms";
import { findOrCreateClient, insertBooking } from "../booking/booking.service";
import { notifyBookingConfirmed } from "../notification/notify";
import { cancelOrder, orderLabel, recordOrderPayment, reviveOrder } from "../shop/shop.service";

export interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: Array<{ Name: string; Value?: string | number }> };
    };
  };
}

export const ACCEPTED = { ResultCode: 0, ResultDesc: "Accepted" } as const;

/** Daraja sends transaction times as yyyymmddhhmmss in Nairobi time (UTC+3, no daylight saving). */
export function parseDarajaTime(value: unknown): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  const at = new Date(Date.UTC(y, mo - 1, d, h - 3, mi, s));
  // Never trust a clock far from ours (a bad value would misplace the payment in the books).
  return Number.isNaN(at.getTime()) || Math.abs(at.getTime() - Date.now()) > 3 * 86_400_000 ? null : at;
}

type StkCallback = NonNullable<NonNullable<StkCallbackBody["Body"]>["stkCallback"]>;

/** The client answered a "pay your balance" prompt sent by the front desk. Safe to receive twice. */
async function handleBalanceCallback(cb: StkCallback) {
  const request = await prisma.paymentRequest.findUnique({ where: { mpesaCheckoutId: cb.CheckoutRequestID } });
  if (!request || request.status === "PAID") return ACCEPTED;

  if (cb.ResultCode !== 0) {
    await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: String(cb.ResultDesc).slice(0, 200) },
    });
    return ACCEPTED;
  }

  const items = cb.CallbackMetadata?.Item ?? [];
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = String(pick("MpesaReceiptNumber") ?? "");
  const amount = Math.round(Number(pick("Amount") ?? 0));
  const paidAt = parseDarajaTime(pick("TransactionDate"));
  if (!receipt || amount <= 0) return ACCEPTED;
  if (await prisma.payment.findUnique({ where: { mpesaReceipt: receipt } })) return ACCEPTED;

  try {
    const left = await prisma.$transaction(async (tx) => {
      // A prompt the dialog already gave up on (EXPIRED) can still be paid, so it is still claimable.
      const claimed = await tx.paymentRequest.updateMany({ where: { id: request.id, status: { in: ["PENDING", "EXPIRED", "FAILED"] } }, data: { status: "PAID", failureReason: null } });
      if (claimed.count === 0) return null;

      const booking = await tx.booking.findUnique({ where: { id: request.bookingId }, include: { payments: { select: { amount: true } } } });
      if (!booking) throw new Error("The booking no longer exists");
      const due = booking.price - booking.discount;
      const paid = booking.payments.reduce((s, p) => s + p.amount, 0);
      // Paid in full some other way (e.g. cash) while the prompt was open: do not book an overpayment.
      if (amount > Math.max(0, due - paid)) throw new Error("The booking was already paid in full");

      await tx.payment.create({
        data: {
          branchId: request.branchId,
          bookingId: booking.id,
          amount,
          method: "MPESA",
          kind: "BALANCE",
          mpesaReceipt: receipt,
          mpesaPhone: request.phone,
          mpesaCallbackId: cb.CheckoutRequestID,
          recordedBy: request.requestedBy,
          notes: "Balance requested by the front desk",
          ...(paidAt ? { paidAt } : {}),
        },
      });
      await tx.booking.update({ where: { id: booking.id }, data: { paid: paid + amount >= due } });
      return Math.max(0, due - paid - amount);
    });

    if (left !== null) {
      void sendSms(
        request.phone,
        left > 0 ? `Payment of KES ${amount.toLocaleString("en-KE")} received (${receipt}). Balance remaining: KES ${left.toLocaleString("en-KE")}. Thank you!` : `Payment of KES ${amount.toLocaleString("en-KE")} received (${receipt}). Your account is fully paid. Thank you!`,
        "balance_received",
      );
    }
  } catch (error: any) {
    // Never lose the money: park it so the front desk can match or refund it.
    console.error(`M-Pesa balance payment ${receipt} received but could not be applied:`, error?.message);
    await prisma.paymentRequest.update({ where: { id: request.id }, data: { status: "CONFLICT", failureReason: String(error?.message ?? "").slice(0, 200) } }).catch(() => {});
    await prisma.pendingPayment
      .create({ data: { branchId: request.branchId, amount, mpesaReceipt: receipt, phone: request.phone, accountRef: `REQ ${request.id.slice(-8)}` } })
      .catch(() => {});
  }
  return ACCEPTED;
}

/** The customer answered the M-Pesa prompt for an online shop order. Safe to receive twice. */
async function handleOrderCallback(cb: StkCallback) {
  const order = await prisma.shopOrder.findUnique({ where: { mpesaCheckoutId: cb.CheckoutRequestID } });
  if (!order) return null;
  if (order.paymentStatus === "PAID") return ACCEPTED;

  if (cb.ResultCode !== 0) {
    await cancelOrder(order.id, "CANCELLED", String(cb.ResultDesc), "FAILED");
    return ACCEPTED;
  }

  const items = cb.CallbackMetadata?.Item ?? [];
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = String(pick("MpesaReceiptNumber") ?? "");
  const amount = Math.round(Number(pick("Amount") ?? 0));
  const paidAt = parseDarajaTime(pick("TransactionDate"));
  if (!receipt) return ACCEPTED;
  if (await prisma.payment.findUnique({ where: { mpesaReceipt: receipt } })) return ACCEPTED;

  try {
    // Must cover the order; a short payment is parked for the front desk instead of releasing goods.
    if (amount < order.total) throw new Error(`Paid ${amount}, order total is ${order.total}`);
    // We gave up on this order (payment looked unconfirmed or timed out), but the customer did pay: take the goods back off the shelf if they are still there.
    if (order.status === "CANCELLED" && order.paymentStatus === "FAILED") await reviveOrder(order.id);
    await recordOrderPayment(order.id, { method: "MPESA", amount, receipt, phone: String(pick("PhoneNumber") ?? order.phone), checkoutId: cb.CheckoutRequestID, paidAt });
  } catch (error: any) {
    // Never lose the money: park it so the front desk can match or refund it.
    console.error(`M-Pesa payment ${receipt} for order ${orderLabel(order.orderNo)} could not be applied:`, error?.message);
    await prisma.pendingPayment
      .create({ data: { branchId: order.branchId, amount, mpesaReceipt: receipt, phone: order.phone, accountRef: orderLabel(order.orderNo) } })
      .catch(() => {});
    // If we had reopened the order for this payment, put it back as it was so no goods are held for money we could not apply.
    const now = await prisma.shopOrder.findUnique({ where: { id: order.id }, select: { paymentStatus: true } });
    if (now && now.paymentStatus !== "PAID") await cancelOrder(order.id, "CANCELLED", "Payment could not be applied", "FAILED").catch(() => {});
  }
  return ACCEPTED;
}

/**
 * Safaricom calls this once the client approves (or rejects) the STK prompt.
 * Safe to receive twice: a hold that is no longer PENDING is ignored.
 */
export async function handleStkCallback(payload: StkCallbackBody) {
  const cb = payload.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ACCEPTED;

  const hold = await prisma.slotHold.findUnique({ where: { mpesaCheckoutId: cb.CheckoutRequestID } });
  // Not a website booking: it may be a balance prompt the front desk sent.
  if (!hold) return (await handleOrderCallback(cb)) ?? handleBalanceCallback(cb);
  // Already booked or already parked: nothing more to do. A hold we gave up on (failed/expired) can still be paid late.
  if (hold.status === "PAID" || hold.status === "CONFLICT") return ACCEPTED;

  if (cb.ResultCode !== 0) {
    await prisma.slotHold.updateMany({
      where: { id: hold.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: String(cb.ResultDesc).slice(0, 200) },
    });
    return ACCEPTED;
  }

  const items = cb.CallbackMetadata?.Item ?? [];
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = String(pick("MpesaReceiptNumber") ?? "");
  const amount = Math.round(Number(pick("Amount") ?? 0));
  if (!receipt) return ACCEPTED;
  const paidAt = parseDarajaTime(pick("TransactionDate"));

  // Already recorded (duplicate delivery racing the status flip).
  const dup = await prisma.payment.findUnique({ where: { mpesaReceipt: receipt } });
  if (dup) return ACCEPTED;

  try {
    const bookingId = await prisma.$transaction(async (tx) => {
      // Claim the hold. If another delivery got here first, count is 0 and we stop.
      const claimed = await tx.slotHold.updateMany({ where: { id: hold.id, status: { in: ["PENDING", "FAILED", "EXPIRED"] } }, data: { status: "PAID", failureReason: null } });
      if (claimed.count === 0) return null;

      const client = await findOrCreateClient(tx, hold.branchId, {
        phone: hold.clientPhone,
        name: hold.clientName ?? "Guest",
        allergies: hold.clientAllergies,
      });
      const booking = await insertBooking(tx, {
        branchId: hold.branchId,
        clientId: client.id,
        staffId: hold.staffId,
        serviceId: hold.serviceId!,
        startAt: hold.startAt,
        source: "ONLINE",
        depositPaid: amount,
        allergies: client.allergies,
      });
      // A "deposit" that covers the whole price settles the booking.
      if (amount >= booking.price - booking.discount) await tx.booking.update({ where: { id: booking.id }, data: { paid: true } });
      await tx.payment.create({
        data: {
          branchId: hold.branchId,
          bookingId: booking.id,
          amount,
          method: "MPESA",
          kind: "DEPOSIT",
          mpesaReceipt: receipt,
          mpesaPhone: hold.clientPhone,
          mpesaCallbackId: cb.CheckoutRequestID,
          ...(paidAt ? { paidAt } : {}),
        },
      });
      await tx.slotHold.update({ where: { id: hold.id }, data: { bookingId: booking.id } });
      return booking.id;
    });

    if (bookingId) void notifyBookingConfirmed(bookingId);
  } catch (error: any) {
    // The client paid but we could not seat them (e.g. the hold lapsed and someone else booked).
    // Never lose the money: park it as an unassigned payment so the front desk can refund or rebook.
    console.error(`M-Pesa deposit ${receipt} received but booking failed:`, error?.message);
    await prisma.slotHold
      .update({ where: { id: hold.id }, data: { status: "CONFLICT", failureReason: String(error?.message ?? "").slice(0, 200) } })
      .catch(() => {});
    await prisma.pendingPayment
      .create({
        data: { branchId: hold.branchId, amount, mpesaReceipt: receipt, phone: hold.clientPhone, accountRef: `HOLD ${hold.id.slice(-8)}` },
      })
      .catch(() => {});
    void sendSms(
      hold.clientPhone,
      `We received your deposit (${receipt}) but your time slot was taken. We will contact you shortly to rebook or refund you in full. Sorry about this!`,
      "booking_conflict",
    );
  }

  return ACCEPTED;
}

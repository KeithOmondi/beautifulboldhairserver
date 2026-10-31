import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/db";
import { env, mpesaEnabled } from "../../config/env";
import { initiateStkPush } from "../../integrations/mpesa";
import { sendSms } from "../../integrations/sms";
import { AppError } from "../../utils/errors";
import { normalizePhone } from "../../utils/phone";
import { findOrCreateClient } from "../booking/booking.service";
import { getBranchById, getPublicBranch } from "../public-booking/public-booking.service";
import type { Prisma } from "../../generated/prisma/client";

const HOLD_MINUTES = 10;
export const orderLabel = (orderNo: number) => `WO-${1000 + orderNo}`;
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/* ─── What the public sees of a product (never the cost price or the exact stock level) ─── */

type ProductRow = Prisma.StockItemGetPayload<object>;

export function publicProduct(p: ProductRow) {
  const onOffer = p.compareAtPrice != null && p.compareAtPrice > p.salePrice;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    images: p.images,
    price: p.salePrice,
    wasPrice: onOffer ? p.compareAtPrice : null,
    discountPct: onOffer ? Math.round((1 - p.salePrice / p.compareAtPrice!) * 100) : null,
    inStock: p.quantity > 0,
    // Only say how many are left when it is genuinely few.
    left: p.quantity > 0 && p.quantity <= 3 ? p.quantity : null,
    isNew: Date.now() - p.createdAt.getTime() < 21 * 86_400_000,
    featured: p.isFeatured,
  };
}

export const publicWhere = (branchId: string): Prisma.StockItemWhereInput => ({ branchId, isPublished: true, isArchived: false });

/* ─── Checkout ─────────────────────────────────────────────────────────── */

export const checkoutSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(40), qty: z.number().int().min(1).max(20) })).min(1, "Your bag is empty").max(30),
  name: z.string().trim().min(2, "Please enter your name").max(80),
  phone: z.string().trim().min(9, "Enter a valid Kenyan phone number").max(20),
  email: z.string().trim().email("Enter a valid email").max(120).optional().or(z.literal("")),
  fulfilment: z.enum(["DELIVERY", "PICKUP"]),
  address: z.string().trim().max(200).optional(),
  area: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(300).optional(),
  payMethod: z.enum(["MPESA", "ON_DELIVERY"]),
  /** M-Pesa number when different from the contact phone. */
  mpesaPhone: z.string().trim().max(20).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export async function shopConfig(branchId?: string) {
  const branch = branchId ? await getBranchById(branchId) : await getPublicBranch();
  const s = branch.settings;
  return {
    name: branch.name,
    phone: branch.phone,
    address: branch.address,
    whatsapp: branch.whatsapp,
    deliveryFee: s?.shopDeliveryFee ?? 0,
    freeOver: s?.shopFreeOver ?? null,
    codAllowed: s?.shopCodAllowed ?? true,
    mpesaEnabled,
  };
}

export const deliveryFeeFor = (fulfilment: "DELIVERY" | "PICKUP", subtotal: number, s: { deliveryFee: number; freeOver: number | null }) =>
  fulfilment === "PICKUP" ? 0 : s.freeOver != null && subtotal >= s.freeOver ? 0 : s.deliveryFee;

/** Puts the stock of a cancelled/failed/expired order back on the shelf. Safe to call once per order. */
async function restoreStock(tx: Prisma.TransactionClient, orderId: string, reason: string) {
  const items = await tx.shopOrderItem.findMany({ where: { orderId } });
  for (const it of items) {
    if (!it.stockItemId) continue;
    await tx.stockItem.update({ where: { id: it.stockItemId }, data: { quantity: { increment: it.quantity } } });
    await tx.stockMovement.create({ data: { stockItemId: it.stockItemId, delta: it.quantity, reason } });
  }
}

/** Ends an order that will not go ahead and returns its stock. Only acts on orders that still hold stock. */
export async function cancelOrder(orderId: string, status: "CANCELLED", reason: string, paymentStatus?: "FAILED") {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.shopOrder.updateMany({
      where: { id: orderId, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "READY"] } },
      data: { status, cancelReason: reason.slice(0, 200), ...(paymentStatus ? { paymentStatus } : {}) },
    });
    if (moved.count === 0) return false;
    await restoreStock(tx, orderId, `Order cancelled: ${reason.slice(0, 60)}`);
    return true;
  });
}

/**
 * Brings back an order we auto-cancelled (payment looked unconfirmed, or timed out) because the money has now arrived.
 * Only if every item is still on the shelf; otherwise it throws and the payment is parked for the front desk to refund.
 */
export async function reviveOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.shopOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status !== "CANCELLED" || order.paymentStatus !== "FAILED") throw new Error("This order can't be reopened");
    for (const it of order.items) {
      if (!it.stockItemId) continue;
      const taken = await tx.stockItem.updateMany({ where: { id: it.stockItemId, quantity: { gte: it.quantity } }, data: { quantity: { decrement: it.quantity } } });
      if (taken.count === 0) throw new Error(`"${it.name}" sold out while the payment was in doubt`);
      await tx.stockMovement.create({ data: { stockItemId: it.stockItemId, delta: -it.quantity, reason: `Order ${orderLabel(order.orderNo)} reopened after late payment` } });
    }
    await tx.shopOrder.update({ where: { id: orderId }, data: { status: "CONFIRMED", cancelReason: null, failureReason: null, expiresAt: null } });
  });
}

export async function createOrder(input: CheckoutInput) {
  const branch = await getPublicBranch();
  const cfg = await shopConfig(branch.id);
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError(400, "Enter a valid Kenyan phone number", "INVALID_PHONE");
  if (input.fulfilment === "DELIVERY" && !(input.address && input.address.length >= 5)) throw new AppError(400, "Please enter your delivery address", "BAD_REQUEST");
  if (input.payMethod === "ON_DELIVERY" && !cfg.codAllowed) throw new AppError(400, "Please pay with M-Pesa", "BAD_REQUEST");
  if (input.payMethod === "MPESA" && !mpesaEnabled) throw new AppError(503, "Online payment is not available right now. Please choose pay on delivery or collection, or call us.", "PAYMENTS_UNAVAILABLE");

  const mpesaPhone = input.payMethod === "MPESA" ? normalizePhone(input.mpesaPhone || input.phone) : null;
  if (input.payMethod === "MPESA" && !mpesaPhone) throw new AppError(400, "Enter a valid M-Pesa number", "INVALID_PHONE");

  // Merge repeated lines so one product can't be counted twice in the stock check.
  const wanted = new Map<string, number>();
  for (const l of input.items) wanted.set(l.id, (wanted.get(l.id) ?? 0) + l.qty);

  const order = await prisma.$transaction(async (tx) => {
    const products = await tx.stockItem.findMany({ where: { id: { in: [...wanted.keys()] }, ...publicWhere(branch.id) } });
    if (products.length !== wanted.size) throw new AppError(409, "Some items in your bag are no longer available. Please review your bag.", "UNAVAILABLE");

    let subtotal = 0;
    for (const p of products) {
      const qty = wanted.get(p.id)!;
      // Conditional decrement: two customers can never both take the last one.
      const taken = await tx.stockItem.updateMany({ where: { id: p.id, quantity: { gte: qty } }, data: { quantity: { decrement: qty } } });
      if (taken.count === 0) throw new AppError(409, p.quantity > 0 ? `Only ${p.quantity} of "${p.name}" left. Please reduce the quantity.` : `"${p.name}" has just sold out.`, "OUT_OF_STOCK");
      subtotal += p.salePrice * qty;
    }
    const deliveryFee = deliveryFeeFor(input.fulfilment, subtotal, cfg);
    const client = await findOrCreateClient(tx, branch.id, { phone, name: input.name });

    const created = await tx.shopOrder.create({
      data: {
        branchId: branch.id,
        clientId: client.id,
        token: randomBytes(24).toString("hex"),
        name: input.name,
        phone,
        email: input.email || null,
        fulfilment: input.fulfilment,
        address: input.fulfilment === "DELIVERY" ? (input.address ?? null) : null,
        area: input.area || null,
        notes: input.notes || null,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        payMethod: input.payMethod,
        status: input.payMethod === "MPESA" ? "PENDING_PAYMENT" : "CONFIRMED",
        expiresAt: input.payMethod === "MPESA" ? new Date(Date.now() + HOLD_MINUTES * 60_000) : null,
        items: {
          create: products.map((p) => ({ stockItemId: p.id, name: p.name, unitPrice: p.salePrice, quantity: wanted.get(p.id)!, image: p.images[0] ?? null })),
        },
      },
    });
    for (const p of products) {
      await tx.stockMovement.create({ data: { stockItemId: p.id, delta: -wanted.get(p.id)!, reason: `Online order ${orderLabel(created.orderNo)}` } });
    }
    return created;
  });

  if (input.payMethod === "ON_DELIVERY") {
    void notifyOrderPlaced(order.id);
    return { token: order.token, orderNo: order.orderNo, requiresPayment: false };
  }

  const stk = await initiateStkPush({ phone: mpesaPhone!, amount: order.total, accountReference: orderLabel(order.orderNo), description: "Shop order" });
  if (!stk.success) {
    await cancelOrder(order.id, "CANCELLED", "M-Pesa could not be started", "FAILED");
    const detail = env.NODE_ENV === "production" ? "" : ` [dev: ${stk.error}]`;
    throw new AppError(502, `We could not start the M-Pesa payment. Check your number and try again.${detail}`, "MPESA_FAILED");
  }
  await prisma.shopOrder.update({ where: { id: order.id }, data: { mpesaCheckoutId: stk.checkoutRequestId } });
  return { token: order.token, orderNo: order.orderNo, requiresPayment: true };
}

/* ─── Recording a payment against an order (M-Pesa callback and staff "mark paid") ─── */

export async function recordOrderPayment(
  orderId: string,
  p: { method: "MPESA" | "CASH"; amount?: number; receipt?: string | null; phone?: string | null; checkoutId?: string | null; paidAt?: Date | null; recordedBy?: string | null },
) {
  const done = await prisma.$transaction(async (tx) => {
    const order = await tx.shopOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("The order no longer exists");
    const claimed = await tx.shopOrder.updateMany({
      where: { id: orderId, paymentStatus: { not: "PAID" }, status: { in: ["PENDING_PAYMENT", "CONFIRMED", "READY"] } },
      data: { paymentStatus: "PAID", paidAt: p.paidAt ?? new Date(), status: order.status === "PENDING_PAYMENT" ? "CONFIRMED" : order.status, expiresAt: null, failureReason: null },
    });
    if (claimed.count === 0) throw new Error("The order was already paid or is cancelled");
    const amount = p.amount ?? order.total;
    await tx.payment.create({
      data: {
        branchId: order.branchId,
        shopOrderId: order.id,
        amount,
        method: p.method,
        kind: "BALANCE",
        mpesaReceipt: p.receipt ?? null,
        mpesaPhone: p.phone ?? null,
        mpesaCallbackId: p.checkoutId ?? null,
        recordedBy: p.recordedBy ?? null,
        notes: `Shop order ${orderLabel(order.orderNo)}`,
        ...(p.paidAt ? { paidAt: p.paidAt } : {}),
      },
    });
    return order;
  });
  void notifyOrderPlaced(done.id, true);
  return done;
}

/* ─── Customer and owner messages ──────────────────────────────────────── */

const trackUrl = (token: string) => `${env.PUBLIC_BOOKING_BASE_URL.replace(/\/$/, "")}/order/${token}`;

/**
 * Who hears about shop orders at the salon: the branch's owners and managers (and any owner who looks after
 * every branch). The person who just did the action is left out, they already know.
 */
async function alertStaff(branchId: string, text: string, key: string, exceptStaffId?: string) {
  const people = await prisma.staff.findMany({
    where: { isActive: true, OR: [{ branchId, role: { in: ["OWNER", "MANAGER"] } }, { role: "OWNER", canSwitchBranches: true }] },
    select: { id: true, phone: true },
  });
  const phones = new Set<string>();
  for (const p of people) {
    if (p.id === exceptStaffId) continue;
    const n = normalizePhone(p.phone);
    if (n) phones.add(n);
  }
  // A branch with nobody to text still has its public phone line.
  if (phones.size === 0 && !exceptStaffId) {
    const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { phone: true } });
    const n = normalizePhone(b?.phone ?? "");
    if (n) phones.add(n);
  }
  await Promise.all([...phones].map((to) => sendSms(to, text, key)));
}

export async function notifyOrderPlaced(orderId: string, paid = false) {
  const o = await prisma.shopOrder.findUnique({ where: { id: orderId }, include: { branch: { select: { name: true, phone: true } } } });
  if (!o) return;
  const how = o.fulfilment === "DELIVERY" ? "We'll deliver it to you" : "We'll tell you when it's ready to collect";
  await sendSms(
    o.phone,
    `${o.branch.name}: order ${orderLabel(o.orderNo)} received${paid || o.paymentStatus === "PAID" ? " and paid" : ""}, total ${kes(o.total)}. ${how}. Track it: ${trackUrl(o.token)}`,
    "order_placed",
  );
  await alertStaff(o.branchId, `New online order ${orderLabel(o.orderNo)} from ${o.name}, ${kes(o.total)} (${o.paymentStatus === "PAID" || paid ? "paid by M-Pesa" : "pay on " + (o.fulfilment === "DELIVERY" ? "delivery" : "collection")}, ${o.fulfilment === "DELIVERY" ? "delivery" : "collection"}). Open Online orders.`, "order_alert");
}

/** `by` is the staff member who made the change: they are not texted about their own action. */
export async function notifyOrderStatus(orderId: string, by?: { id: string; name: string }, reason?: string) {
  const o = await prisma.shopOrder.findUnique({ where: { id: orderId }, include: { branch: { select: { name: true } } } });
  if (!o) return;
  const text =
    o.status === "READY"
      ? o.fulfilment === "DELIVERY"
        ? `${o.branch.name}: your order ${orderLabel(o.orderNo)} is on its way.`
        : `${o.branch.name}: your order ${orderLabel(o.orderNo)} is ready for collection.`
      : o.status === "COMPLETED"
        ? `${o.branch.name}: thank you! Order ${orderLabel(o.orderNo)} is complete.`
        : o.status === "CANCELLED"
          ? `${o.branch.name}: order ${orderLabel(o.orderNo)} was cancelled${o.paymentStatus === "PAID" ? ". We will refund you shortly" : ""}.`
          : null;
  if (text) await sendSms(o.phone, `${text} ${trackUrl(o.token)}`, "order_status");

  // The owners and managers hear when an order is finished or called off, and who did it.
  const who = by ? ` by ${by.name}` : "";
  if (o.status === "COMPLETED") await alertStaff(o.branchId, `Order ${orderLabel(o.orderNo)} ${o.fulfilment === "DELIVERY" ? "delivered" : "collected"}${who}: ${o.name}, ${kes(o.total)}${o.paymentStatus === "PAID" ? ", paid" : ""}.`, "order_alert", by?.id);
  if (o.status === "CANCELLED") await alertStaff(o.branchId, `Order ${orderLabel(o.orderNo)} cancelled${who}: ${o.name}, ${kes(o.total)}${reason ? `. Reason: ${reason}` : ""}${o.paymentStatus === "PAID" ? ". Customer paid, refund due." : "."}`, "order_alert", by?.id);
}

/* ─── Housekeeping ─────────────────────────────────────────────────────── */

/** Unpaid M-Pesa orders hold stock for a few minutes; after that the stock goes back on the shelf. */
export async function expireStaleOrders() {
  const stale = await prisma.shopOrder.findMany({ where: { status: "PENDING_PAYMENT", expiresAt: { lt: new Date() } }, select: { id: true }, take: 50 });
  for (const o of stale) await cancelOrder(o.id, "CANCELLED", "Payment not completed in time", "FAILED").catch(() => {});
  return stale.length;
}

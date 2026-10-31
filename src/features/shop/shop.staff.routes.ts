import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import type { Prisma } from "../../generated/prisma/client";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { AppError } from "../../utils/errors";
import { cancelOrder, notifyOrderStatus, orderLabel, recordOrderPayment, reviveOrder } from "./shop.service";

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

const productSchema = z.object({
  name: z.string().trim().min(2, "Give the product a name").max(120),
  sku: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(1500).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
  images: z.array(z.string().url().max(500).startsWith("https://res.cloudinary.com/", "Photos must be uploaded through the shop")).max(6).optional(),
  costPrice: z.number().int().min(0).max(10_000_000).optional(),
  salePrice: z.number().int().min(0).max(10_000_000),
  /** The normal price, shown crossed out. Must be above salePrice. */
  compareAtPrice: z.number().int().min(0).max(10_000_000).nullable().optional(),
  quantity: z.number().int().min(0).max(100_000).optional(),
  reorderAt: z.number().int().min(0).max(100_000).optional(),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

/** Who is making this change, for the alert texts. */
const actor = async (req: FastifyRequest) => {
  const s = await prisma.staff.findUnique({ where: { id: req.user.sub }, select: { id: true, name: true } });
  return s ?? undefined;
};

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export async function shopStaffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);
  const managers = { preHandler: [authorize("OWNER", "MANAGER")] };
  const frontDesk = { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST")] };

  /* ─── Inventory ─── */

  app.get("/products", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { archived } = z.object({ archived: z.enum(["1"]).optional() }).parse(req.query);
    const rows = await prisma.stockItem.findMany({
      where: { branchId: req.user.branchId, isArchived: archived ? true : false },
      orderBy: [{ createdAt: "desc" }],
    });
    return reply.send(rows);
  });

  app.post("/products", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const d = productSchema.parse(req.body);
    if (d.compareAtPrice != null && d.compareAtPrice <= d.salePrice) throw new AppError(400, "The normal price must be higher than the selling price", "BAD_REQUEST");
    const branchId = req.user.branchId;
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.create({
        data: {
          branchId,
          name: d.name,
          sku: d.sku || null,
          description: d.description ?? null,
          category: d.category?.trim() || null,
          images: d.images ?? [],
          costPrice: d.costPrice ?? 0,
          salePrice: d.salePrice,
          compareAtPrice: d.compareAtPrice ?? null,
          quantity: d.quantity ?? 0,
          reorderAt: d.reorderAt ?? 0,
          isPublished: d.isPublished ?? false,
          isFeatured: d.isFeatured ?? false,
        },
      });
      if ((d.quantity ?? 0) > 0) await tx.stockMovement.create({ data: { stockItemId: item.id, delta: d.quantity!, reason: "Opening stock", actorId: req.user.sub } });
      return item;
    });
    return reply.status(201).send(created);
  });

  // Quantity is changed only through /stock so every change leaves a trail.
  app.patch("/products/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const d = productSchema.omit({ quantity: true }).partial().parse(req.body);
    const found = await prisma.stockItem.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Product not found", "NOT_FOUND");
    const nextSale = d.salePrice ?? found.salePrice;
    const nextCompare = d.compareAtPrice !== undefined ? d.compareAtPrice : found.compareAtPrice;
    if (nextCompare != null && nextCompare <= nextSale) throw new AppError(400, "The normal price must be higher than the selling price", "BAD_REQUEST");
    const data = clean({
      ...d,
      sku: d.sku === undefined ? undefined : d.sku || null,
      category: d.category === undefined ? undefined : d.category?.trim() || null,
    }) as Prisma.StockItemUpdateInput;
    return reply.send(await prisma.stockItem.update({ where: { id: found.id }, data }));
  });

  app.post("/products/:id/stock", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { delta, reason } = z
      .object({ delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Enter how many to add or remove"), reason: z.string().trim().min(2, "Give a reason").max(80) })
      .parse(req.body);
    const found = await prisma.stockItem.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Product not found", "NOT_FOUND");
    const updated = await prisma.$transaction(async (tx) => {
      // Conditional so stock can never go below zero, even with two people adjusting at once.
      const ok = await tx.stockItem.updateMany({ where: { id: found.id, quantity: { gte: delta < 0 ? -delta : 0 } }, data: { quantity: { increment: delta } } });
      if (ok.count === 0) throw new AppError(409, "There aren't that many in stock to remove", "OUT_OF_STOCK");
      await tx.stockMovement.create({ data: { stockItemId: found.id, delta, reason, actorId: req.user.sub } });
      return tx.stockItem.findUniqueOrThrow({ where: { id: found.id } });
    });
    return reply.send(updated);
  });

  app.get("/products/:id/movements", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.stockItem.findFirst({ where: { id: idOf(req), branchId: req.user.branchId }, select: { id: true } });
    if (!found) throw new AppError(404, "Product not found", "NOT_FOUND");
    const rows = await prisma.stockMovement.findMany({ where: { stockItemId: found.id }, orderBy: { createdAt: "desc" }, take: 40 });
    const staff = await prisma.staff.findMany({ where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
    const by = new Map(staff.map((s) => [s.id, s.name]));
    return reply.send(rows.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, at: r.createdAt, by: r.actorId ? (by.get(r.actorId) ?? "Former staff") : "System" })));
  });

  // Products with order history are archived (hidden) instead of deleted, so past orders keep their details.
  app.delete("/products/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.stockItem.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Product not found", "NOT_FOUND");
    const used = await prisma.shopOrderItem.count({ where: { stockItemId: found.id } });
    if (used > 0) {
      await prisma.stockItem.update({ where: { id: found.id }, data: { isArchived: true, isPublished: false, isFeatured: false } });
      return reply.send({ message: "Archived (it has past orders)", archived: true });
    }
    await prisma.stockItem.delete({ where: { id: found.id } });
    return reply.send({ message: "Deleted", archived: false });
  });

  app.post("/products/:id/restore", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.stockItem.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Product not found", "NOT_FOUND");
    return reply.send(await prisma.stockItem.update({ where: { id: found.id }, data: { isArchived: false } }));
  });

  /* ─── Orders ─── */

  const orderInclude = { items: true, payments: { select: { id: true, amount: true, method: true, mpesaReceipt: true, paidAt: true } } } satisfies Prisma.ShopOrderInclude;
  const shape = (o: Prisma.ShopOrderGetPayload<{ include: typeof orderInclude }>) => ({ ...o, label: orderLabel(o.orderNo) });

  app.get("/orders", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const f = z
      .object({ status: z.enum(["PENDING_PAYMENT", "CONFIRMED", "READY", "COMPLETED", "CANCELLED"]).optional(), q: z.string().trim().max(40).optional() })
      .parse(req.query);
    const digits = f.q?.replace(/\D/g, "") ?? "";
    const rows = await prisma.shopOrder.findMany({
      where: {
        branchId: req.user.branchId,
        ...(f.status ? { status: f.status } : {}),
        ...(f.q
          ? {
              OR: [
                { name: { contains: f.q, mode: "insensitive" } },
                ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-9) } }] : []),
                ...(/^(wo-?)?\d{4,}$/i.test(f.q) ? [{ orderNo: { equals: Number(f.q.replace(/\D/g, "")) - 1000 } }] : []),
              ],
            }
          : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return reply.send(rows.map(shape));
  });

  // Counts for the sidebar badge and the dashboard.
  app.get("/orders/summary", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const g = await prisma.shopOrder.groupBy({ by: ["status"], where: { branchId: req.user.branchId }, _count: { _all: true } });
    const n = (s: string) => g.find((x) => x.status === s)?._count._all ?? 0;
    return reply.send({ toHandle: n("CONFIRMED"), ready: n("READY"), awaitingPayment: n("PENDING_PAYMENT") });
  });

  app.patch("/orders/:id/status", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const { status } = z.object({ status: z.enum(["READY", "COMPLETED"]) }).parse(req.body);
    const order = await prisma.shopOrder.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!order) throw new AppError(404, "Order not found", "NOT_FOUND");
    if (order.status === "PENDING_PAYMENT") throw new AppError(409, "This order hasn't been paid yet", "BAD_REQUEST");
    if (order.status === "CANCELLED" || order.status === "COMPLETED") throw new AppError(409, "This order is already closed", "BAD_REQUEST");
    if (status === "COMPLETED" && order.paymentStatus !== "PAID") throw new AppError(409, "Record the payment before completing the order", "UNPAID");
    await prisma.shopOrder.update({ where: { id: order.id }, data: { status } });
    void notifyOrderStatus(order.id, await actor(req));
    return reply.send({ message: "Updated" });
  });

  // Cash (or an M-Pesa code) collected at the door or the counter.
  app.post("/orders/:id/mark-paid", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({ method: z.enum(["CASH", "MPESA"]), receipt: z.string().trim().min(6).max(20).optional() }).parse(req.body);
    const order = await prisma.shopOrder.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!order) throw new AppError(404, "Order not found", "NOT_FOUND");
    if (body.method === "MPESA" && !body.receipt) throw new AppError(400, "Enter the M-Pesa code", "BAD_REQUEST");
    if (order.paymentStatus === "PAID") throw new AppError(409, "This order is already paid", "ALREADY_PAID");
    // An order the system closed because the payment looked unconfirmed can be reopened when staff see the money arrive.
    const autoClosed = order.status === "CANCELLED" && order.paymentStatus === "FAILED";
    if (order.status === "CANCELLED" && !autoClosed) throw new AppError(409, "This order was cancelled", "BAD_REQUEST");
    try {
      if (autoClosed) await reviveOrder(order.id);
      await recordOrderPayment(order.id, { method: body.method, receipt: body.receipt?.toUpperCase() ?? null, phone: body.method === "MPESA" ? order.phone : null, recordedBy: req.user.sub });
    } catch (e: any) {
      if (e?.code === "P2002") throw new AppError(409, "That M-Pesa code is already recorded", "DUPLICATE");
      throw new AppError(409, e?.message ?? "Could not record the payment", "BAD_REQUEST");
    }
    return reply.send({ message: "Payment recorded" });
  });

  app.post("/orders/:id/cancel", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(150) }).parse(req.body);
    const order = await prisma.shopOrder.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!order) throw new AppError(404, "Order not found", "NOT_FOUND");
    if (order.status === "COMPLETED") throw new AppError(409, "A completed order can't be cancelled", "BAD_REQUEST");
    const done = await cancelOrder(order.id, "CANCELLED", reason);
    if (!done) throw new AppError(409, "This order is already closed", "BAD_REQUEST");
    void notifyOrderStatus(order.id, await actor(req), reason);
    return reply.send({ message: order.paymentStatus === "PAID" ? "Cancelled. Remember to refund the customer." : "Cancelled", refundDue: order.paymentStatus === "PAID" });
  });
}

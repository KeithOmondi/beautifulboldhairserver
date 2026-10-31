import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { queryStkStatus, isFinalStkFailure } from "../../integrations/mpesa";
import { AppError } from "../../utils/errors";
import { getPublicBranch } from "../public-booking/public-booking.service";
import { cancelOrder, checkoutSchema, createOrder, expireStaleOrders, orderLabel, publicProduct, publicWhere, shopConfig } from "./shop.service";

const listSchema = z.object({
  category: z.string().trim().max(60).optional(),
  q: z.string().trim().max(60).optional(),
  sale: z.enum(["1"]).optional(),
  sort: z.enum(["new", "price_asc", "price_desc", "popular"]).default("new"),
  limit: z.coerce.number().int().min(1).max(60).default(48),
  featured: z.enum(["1"]).optional(),
});

async function list(req: FastifyRequest, reply: FastifyReply) {
  const f = listSchema.parse(req.query);
  const branch = await getPublicBranch();
  const where = {
    ...publicWhere(branch.id),
    ...(f.category ? { category: f.category } : {}),
    ...(f.featured ? { isFeatured: true } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { description: { contains: f.q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, cats] = await Promise.all([
    prisma.stockItem.findMany({
      where,
      orderBy: f.sort === "price_asc" ? [{ salePrice: "asc" }] : f.sort === "price_desc" ? [{ salePrice: "desc" }] : [{ createdAt: "desc" }],
      take: 200,
    }),
    prisma.stockItem.groupBy({ by: ["category"], where: publicWhere(branch.id), _count: { _all: true } }),
  ]);
  let products = rows.map(publicProduct);
  if (f.sale) products = products.filter((p) => p.wasPrice != null);
  // Sold-out products sink to the bottom rather than disappearing, like a real shop.
  products.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  reply.header("Cache-Control", "no-store");
  return reply.send({
    products: products.slice(0, f.limit),
    total: products.length,
    categories: cats.filter((c) => c.category).map((c) => ({ name: c.category!, count: c._count._all })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

async function one(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const branch = await getPublicBranch();
  const row = await prisma.stockItem.findFirst({ where: { id, ...publicWhere(branch.id) } });
  if (!row) throw new AppError(404, "We couldn't find that product", "NOT_FOUND");
  const related = await prisma.stockItem.findMany({
    where: { ...publicWhere(branch.id), id: { not: row.id }, ...(row.category ? { category: row.category } : {}) },
    orderBy: { createdAt: "desc" },
    take: 4,
  });
  reply.header("Cache-Control", "no-store");
  return reply.send({ product: publicProduct(row), related: related.map(publicProduct) });
}

/** What the bag needs to price itself: current prices and stock for the ids it holds. */
async function bag(req: FastifyRequest, reply: FastifyReply) {
  const { ids } = z.object({ ids: z.array(z.string().max(40)).max(30) }).parse(req.body);
  const branch = await getPublicBranch();
  const rows = await prisma.stockItem.findMany({ where: { id: { in: ids }, ...publicWhere(branch.id) } });
  return reply.send({ products: rows.map((r) => ({ ...publicProduct(r), max: Math.min(r.quantity, 20) })) });
}

async function checkout(req: FastifyRequest, reply: FastifyReply) {
  const input = checkoutSchema.parse(req.body);
  return reply.status(201).send(await createOrder(input));
}

const orderView = async (token: string) => {
  const o = await prisma.shopOrder.findUnique({ where: { token }, include: { items: true } });
  if (!o) throw new AppError(404, "We couldn't find that order", "NOT_FOUND");
  return o;
};

/** Polled by the checkout page while the customer approves the M-Pesa prompt, and used by the tracking page. */
async function trackOrder(req: FastifyRequest, reply: FastifyReply) {
  const { token } = req.params as { token: string };
  let o = await orderView(token);

  if (o.status === "PENDING_PAYMENT") {
    if (o.expiresAt && o.expiresAt <= new Date()) {
      await expireStaleOrders();
      o = await orderView(token);
    } else if (o.mpesaCheckoutId && Date.now() - o.createdAt.getTime() > 25_000) {
      // If the callback is late, ask Safaricom directly so a cancelled prompt frees the stock quickly.
      const q = await queryStkStatus(o.mpesaCheckoutId);
      if (q.success && isFinalStkFailure(q.resultCode)) {
        await cancelOrder(o.id, "CANCELLED", q.resultDesc, "FAILED");
        o = await orderView(token);
      }
    }
  }

  reply.header("Cache-Control", "no-store");
  return reply.send({
    orderNo: o.orderNo,
    label: orderLabel(o.orderNo),
    status: o.status,
    paymentStatus: o.paymentStatus,
    payMethod: o.payMethod,
    fulfilment: o.fulfilment,
    address: o.address,
    area: o.area,
    name: o.name,
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    createdAt: o.createdAt,
    cancelReason: o.status === "CANCELLED" ? o.cancelReason : null,
    items: o.items.map((i) => ({ id: i.id, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity, image: i.image })),
    config: await shopConfig(o.branchId),
  });
}

export async function shopPublicRoutes(app: FastifyInstance) {
  app.get("/shop/config", async (_req, reply) => reply.send(await shopConfig()));
  app.get("/shop/products", list);
  app.get("/shop/products/:id", one);
  app.post("/shop/bag", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, bag);
  app.post("/shop/checkout", { config: { rateLimit: { max: 25, timeWindow: "10 minutes" } } }, checkout);
  app.get("/shop/orders/:token", { config: { rateLimit: { max: 90, timeWindow: "10 minutes" } } }, trackOrder);
}

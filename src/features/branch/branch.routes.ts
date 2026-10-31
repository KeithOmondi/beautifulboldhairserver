import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { authenticate } from "../../middleware/auth.middleware";
import { AppError } from "../../utils/errors";
import { dayEnd, dayStart, todayString } from "../../utils/time";

const slugOf = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes only")
  .min(2)
  .max(40);

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the branch a name").max(80),
  city: z.string().trim().min(2).max(40).nullable().optional(),
  slug: slugSchema.optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  tagline: z.string().trim().max(140).nullable().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  city: z.string().trim().min(2).max(40).nullable().optional(),
  slug: slugSchema.optional(),
  sortOrder: z.number().int().min(0).max(99).optional(),
  isActive: z.boolean().optional(),
});

const select = { id: true, name: true, city: true, slug: true, sortOrder: true, isActive: true, phone: true, address: true } as const;

/** Branch management. Anyone signed in can list the branches they may use; only a person allowed to span branches can change them. */
export async function branchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  const spanning = (req: FastifyRequest) => {
    if (req.user.role !== "OWNER" || !req.user.canSwitchBranches) throw new AppError(403, "Only an owner who manages all branches can do this", "FORBIDDEN");
  };

  app.get("/", async (req: FastifyRequest, reply: FastifyReply) => {
    const home = req.user.homeBranchId ?? req.user.branchId;
    const rows = await prisma.branch.findMany({
      where: req.user.canSwitchBranches ? (req.user.role === "OWNER" ? {} : { isActive: true }) : { id: home },
      select,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return reply.send({ homeBranchId: home, canSwitch: Boolean(req.user.canSwitchBranches), branches: rows });
  });

  /** How every branch is doing, side by side: the owner's view of the whole business. */
  app.get("/overview", async (req: FastifyRequest, reply: FastifyReply) => {
    spanning(req);
    const today = todayString();
    const monthFrom = `${today.slice(0, 8)}01`;
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const rows = await Promise.all(
      branches.map(async (b) => {
        const [bookings, todayPay, monthPay, staff, orders, stock] = await Promise.all([
          prisma.booking.count({ where: { branchId: b.id, startAt: { gte: dayStart(today), lt: dayEnd(today) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } }),
          prisma.payment.aggregate({ where: { branchId: b.id, paidAt: { gte: dayStart(today), lt: dayEnd(today) } }, _sum: { amount: true } }),
          prisma.payment.aggregate({ where: { branchId: b.id, paidAt: { gte: dayStart(monthFrom), lt: dayEnd(today) } }, _sum: { amount: true } }),
          prisma.staff.count({ where: { branchId: b.id, isActive: true } }),
          prisma.shopOrder.count({ where: { branchId: b.id, status: "CONFIRMED" } }),
          prisma.stockItem.findMany({ where: { branchId: b.id, isArchived: false }, select: { quantity: true, reorderAt: true } }),
        ]);
        return {
          id: b.id,
          name: b.name,
          city: b.city,
          bookingsToday: bookings,
          revenueToday: todayPay._sum.amount ?? 0,
          revenueMonth: monthPay._sum.amount ?? 0,
          staff,
          ordersToHandle: orders,
          lowStock: stock.filter((s) => s.quantity <= s.reorderAt).length,
        };
      }),
    );
    return reply.send({ rows, totals: { bookingsToday: rows.reduce((n, r) => n + r.bookingsToday, 0), revenueToday: rows.reduce((n, r) => n + r.revenueToday, 0), revenueMonth: rows.reduce((n, r) => n + r.revenueMonth, 0) } });
  });

  /**
   * Sets up a new branch quickly: copies another branch's services (and, optionally, its products with no stock)
   * so the menu does not have to be typed again. Existing names are skipped, so running it twice is safe.
   */
  app.post("/:id/copy-from", async (req: FastifyRequest, reply: FastifyReply) => {
    spanning(req);
    const { id } = req.params as { id: string };
    const { fromId, products } = z.object({ fromId: z.string().min(1), products: z.boolean().default(false) }).parse(req.body);
    if (id === fromId) throw new AppError(400, "Pick a different branch to copy from", "BAD_REQUEST");
    const [target, source] = await Promise.all([prisma.branch.findUnique({ where: { id } }), prisma.branch.findUnique({ where: { id: fromId } })]);
    if (!target || !source) throw new AppError(404, "Branch not found", "NOT_FOUND");

    const result = await prisma.$transaction(async (tx) => {
      const haveS = new Set((await tx.service.findMany({ where: { branchId: id }, select: { name: true } })).map((s) => s.name));
      const svc = (await tx.service.findMany({ where: { branchId: fromId, isActive: true } })).filter((s) => !haveS.has(s.name));
      for (const s of svc) {
        await tx.service.create({ data: { branchId: id, name: s.name, durationMin: s.durationMin, price: s.price, salePrice: s.salePrice, category: s.category, imageUrl: s.imageUrl, requiresPatchTest: s.requiresPatchTest, isWigService: s.isWigService, description: s.description } });
      }
      let prod = 0;
      if (products) {
        const haveP = new Set((await tx.stockItem.findMany({ where: { branchId: id }, select: { name: true } })).map((p) => p.name));
        const items = (await tx.stockItem.findMany({ where: { branchId: fromId, isArchived: false } })).filter((p) => !haveP.has(p.name));
        for (const p of items) {
          // Stock is physical: it starts at zero and unpublished until this branch counts what it really has.
          await tx.stockItem.create({ data: { branchId: id, name: p.name, sku: p.sku, description: p.description, category: p.category, images: p.images, costPrice: p.costPrice, salePrice: p.salePrice, compareAtPrice: p.compareAtPrice, reorderAt: p.reorderAt, quantity: 0, isPublished: false } });
        }
        prod = items.length;
      }
      return { services: svc.length, products: prod };
    });
    return reply.send(result);
  });

  app.post("/", async (req: FastifyRequest, reply: FastifyReply) => {
    spanning(req);
    const d = createSchema.parse(req.body);
    const slug = d.slug ?? (slugOf(d.city ?? d.name) || "branch");
    if (await prisma.branch.findUnique({ where: { slug } })) throw new AppError(409, "Another branch already uses that web name. Pick a different one.", "DUPLICATE_SLUG");
    const count = await prisma.branch.count();
    const created = await prisma.branch.create({
      data: { name: d.name, city: d.city ?? null, slug, sortOrder: count, phone: d.phone ?? null, address: d.address ?? null, tagline: d.tagline ?? null, settings: { create: {} } },
      select,
    });
    return reply.status(201).send(created);
  });

  app.patch("/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    spanning(req);
    const { id } = req.params as { id: string };
    const d = updateSchema.parse(req.body);
    const found = await prisma.branch.findUnique({ where: { id } });
    if (!found) throw new AppError(404, "Branch not found", "NOT_FOUND");

    if (d.slug && d.slug !== found.slug && (await prisma.branch.findUnique({ where: { slug: d.slug } }))) throw new AppError(409, "Another branch already uses that web name", "DUPLICATE_SLUG");
    if (d.isActive === false) {
      if (id === (req.user.homeBranchId ?? req.user.branchId)) throw new AppError(400, "You can't switch off your own branch", "BAD_REQUEST");
      const others = await prisma.branch.count({ where: { isActive: true, id: { not: id } } });
      if (others === 0) throw new AppError(400, "At least one branch must stay open", "BAD_REQUEST");
    }
    const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
    return reply.send(await prisma.branch.update({ where: { id }, data, select }));
  });
}

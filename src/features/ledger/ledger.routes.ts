import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import type { Prisma } from "../../generated/prisma/client";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { addDays, dayEnd, dayStart, todayString } from "../../utils/time";

/**
 * The owner's payment ledger: every shilling in and out, with who paid, the M-Pesa code, the phone and the time.
 * Read-only on purpose. Payments are recorded by the booking, M-Pesa and till flows, and refunded in Money.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const filterSchema = z.object({
  from: z.string().regex(dateRe).optional(),
  to: z.string().regex(dateRe).optional(),
  method: z.enum(["CASH", "MPESA", "CARD"]).optional(),
  kind: z.enum(["DEPOSIT", "BALANCE", "REFUND"]).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  /** "1" = every branch together. Honoured only for an owner who manages all branches. */
  all: z.enum(["1"]).optional(),
});

/** The branch to count, or null for the whole business. Anyone else asking for "all" simply gets their own branch. */
const scopeOf = (req: FastifyRequest, f: { all?: "1" | undefined }) =>
  f.all === "1" && req.user.role === "OWNER" && req.user.canSwitchBranches ? null : req.user.branchId;

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 20_000;

/** `null` means every branch, which only an owner who manages all branches may ask for (see scopeOf). */
function whereFrom(branchId: string | null, f: z.infer<typeof filterSchema>): Prisma.PaymentWhereInput {
  const today = todayString();
  const to = f.to ?? today;
  const from = f.from ?? addDays(to, -29);
  const where: Prisma.PaymentWhereInput = { ...(branchId ? { branchId } : {}), paidAt: { gte: dayStart(from), lt: dayEnd(to) } };
  if (f.method) where.method = f.method;
  if (f.kind) where.kind = f.kind;

  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    const or: Prisma.PaymentWhereInput[] = [
      { mpesaReceipt: { contains: f.q, mode: "insensitive" } },
      { booking: { client: { name: { contains: f.q, mode: "insensitive" } } } },
    ];
    // Phones are stored as +2547..., so match the last nine digits however the owner typed it (0712..., 254712..., 712...).
    if (digits.length >= 4) {
      const tail = digits.slice(-9);
      or.push({ mpesaPhone: { contains: tail } }, { booking: { client: { phone: { contains: tail } } } });
    }
    where.OR = or;
  }
  return where;
}

const include = {
  branch: { select: { name: true, city: true } },
  shopOrder: { select: { orderNo: true, name: true, phone: true } },
  booking: { select: { id: true, price: true, discount: true, client: { select: { name: true, phone: true } }, service: { select: { name: true } } } },
} satisfies Prisma.PaymentInclude;

type Row = Prisma.PaymentGetPayload<{ include: typeof include }>;

async function shape(branchId: string | null, rows: Row[]) {
  // Payments with no booking (till payments, matched M-Pesa) still show a name when the phone belongs to a known client.
  // Clients are per branch, so look names up by branch and phone together.
  const phones = [...new Set(rows.filter((r) => !r.booking && r.mpesaPhone).map((r) => r.mpesaPhone!))];
  const clients = phones.length ? await prisma.client.findMany({ where: { ...(branchId ? { branchId } : {}), phone: { in: phones } }, select: { branchId: true, phone: true, name: true } }) : [];
  const nameByPhone = new Map(clients.map((c) => [`${c.branchId}|${c.phone}`, c.name]));

  const staffIds = [...new Set(rows.map((r) => r.recordedBy).filter((x): x is string => Boolean(x)))];
  const staff = staffIds.length ? await prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(staff.map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    id: r.id,
    paidAt: r.paidAt,
    recordedAt: r.createdAt,
    amount: r.amount,
    method: r.method,
    kind: r.kind,
    paidInFull: r.kind === "DEPOSIT" && r.booking !== null && r.amount >= r.booking.price - r.booking.discount,
    receipt: r.mpesaReceipt,
    phone: r.mpesaPhone ?? r.booking?.client.phone ?? r.shopOrder?.phone ?? null,
    clientName: r.booking?.client.name ?? r.shopOrder?.name ?? (r.mpesaPhone ? (nameByPhone.get(`${r.branchId}|${r.mpesaPhone}`) ?? null) : null),
    branchName: r.branch.city ?? r.branch.name,
    service: r.booking?.service.name ?? (r.shopOrder ? `Shop order WO-${1000 + r.shopOrder.orderNo}` : null),
    bookingId: r.bookingId,
    // Online deposits are recorded by the system itself; everything else by the named staff member.
    recordedBy: r.recordedBy ? (nameById.get(r.recordedBy) ?? "Former staff") : r.mpesaCallbackId ? "M-Pesa (automatic)" : "System",
    notes: r.notes,
  }));
}

/** Spreadsheet programs run text starting with = + - @ as a formula; neutralise it in exported cells. */
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function ledgerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);
  const ownerOnly = { preHandler: [authorize("OWNER")] };

  app.get("/", ownerOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const f = filterSchema.parse(req.query);
    const branchId = scopeOf(req, f);
    const where = whereFrom(branchId, f);

    const [rows, count, byMethod, byKind] = await Promise.all([
      prisma.payment.findMany({ where, include, orderBy: [{ paidAt: "desc" }, { id: "desc" }], skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.payment.count({ where }),
      prisma.payment.groupBy({ by: ["method"], where, _sum: { amount: true } }),
      prisma.payment.groupBy({ by: ["kind"], where, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const kindSum = (k: string) => byKind.find((x) => x.kind === k)?._sum.amount ?? 0;
    const methodSum = (m: string) => byMethod.find((x) => x.method === m)?._sum.amount ?? 0;
    const refunded = Math.abs(kindSum("REFUND"));
    const collected = kindSum("DEPOSIT") + kindSum("BALANCE");

    const unmatched = await prisma.pendingPayment.aggregate({ where: { ...(branchId ? { branchId } : {}), isAssigned: false }, _count: { _all: true }, _sum: { amount: true } });

    // With every branch together, show what each one took so the owner can compare them.
    let byBranch: Array<{ id: string; name: string; net: number; count: number }> = [];
    if (branchId === null) {
      const [sums, names] = await Promise.all([
        prisma.payment.groupBy({ by: ["branchId"], where, _sum: { amount: true }, _count: { _all: true } }),
        prisma.branch.findMany({ select: { id: true, name: true, city: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
      ]);
      byBranch = names.map((b) => ({ id: b.id, name: b.city ?? b.name, net: sums.find((s) => s.branchId === b.id)?._sum.amount ?? 0, count: sums.find((s) => s.branchId === b.id)?._count._all ?? 0 })).filter((b) => b.count > 0);
    }

    return reply.send({
      byBranch,
      rows: await shape(branchId, rows),
      page: f.page,
      pageSize: PAGE_SIZE,
      total: count,
      totals: {
        collected,
        refunded,
        net: collected - refunded,
        deposits: kindSum("DEPOSIT"),
        balances: kindSum("BALANCE"),
        byMethod: { CASH: methodSum("CASH"), MPESA: methodSum("MPESA"), CARD: methodSum("CARD") },
      },
      unmatched: { count: unmatched._count._all, amount: unmatched._sum.amount ?? 0 },
    });
  });

  /**
   * One row per client with everything they paid, however many payments it took (deposit, balance, part payments).
   * A client appears if any of their bookings had a payment in the period; each booking shows ALL its payments.
   */
  app.get("/by-client", ownerOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const f = filterSchema.parse(req.query);
    const branchId = scopeOf(req, f);
    const inPeriod = await prisma.payment.findMany({
      where: { ...whereFrom(branchId, f), bookingId: { not: null } },
      select: { bookingId: true },
      take: 5_000,
    });
    const bookingIds = [...new Set(inPeriod.map((p) => p.bookingId!))];
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds }, ...(branchId ? { branchId } : {}) },
      orderBy: { startAt: "desc" },
      select: {
        id: true, startAt: true, price: true, discount: true, status: true,
        client: { select: { id: true, name: true, phone: true } },
        service: { select: { name: true } },
        payments: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, method: true, kind: true, mpesaReceipt: true, paidAt: true, notes: true } },
      },
    });

    type Group = { clientId: string; name: string; phone: string; paid: number; refunded: number; lastPaidAt: Date; bookings: unknown[] };
    const groups = new Map<string, Group>();
    for (const b of bookings) {
      const g = groups.get(b.client.id) ?? { clientId: b.client.id, name: b.client.name, phone: b.client.phone, paid: 0, refunded: 0, lastPaidAt: new Date(0), bookings: [] };
      const due = b.price - b.discount;
      const paid = b.payments.reduce((a, x) => a + x.amount, 0);
      for (const x of b.payments) {
        if (x.amount < 0) g.refunded += -x.amount;
        else g.paid += x.amount;
        if (x.paidAt > g.lastPaidAt) g.lastPaidAt = x.paidAt;
      }
      g.bookings.push({ id: b.id, service: b.service.name, startAt: b.startAt, status: b.status, due, paid, balance: Math.max(0, due - paid), payments: b.payments });
      groups.set(b.client.id, g);
    }
    const clients = [...groups.values()]
      .map((g) => ({ ...g, net: g.paid - g.refunded }))
      .sort((a, b) => b.lastPaidAt.getTime() - a.lastPaidAt.getTime())
      .slice(0, 300);
    return reply.send({ clients, totalClients: groups.size, net: clients.reduce((a, c) => a + c.net, 0) });
  });

  app.get("/export.csv", { ...ownerOnly, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const f = filterSchema.parse(req.query);
    const branchId = scopeOf(req, f);
    const rows = await shape(
      branchId,
      await prisma.payment.findMany({ where: whereFrom(branchId, f), include, orderBy: [{ paidAt: "asc" }, { id: "asc" }], take: EXPORT_LIMIT }),
    );
    const nairobi = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
    const head = ["Date and time (Nairobi)", "Branch", "Client", "Phone", "M-Pesa code", "Method", "Type", "Amount (KES)", "Service", "Recorded by", "Notes"];
    const lines = [head, ...rows.map((r) => [nairobi(r.paidAt), r.branchName, r.clientName ?? "", r.phone ?? "", r.receipt ?? "", r.method, r.kind, r.amount, r.service ?? "", r.recordedBy, r.notes ?? ""])];
    return reply
      .header("Content-Disposition", `attachment; filename="payments-${todayString()}.csv"`)
      .type("text/csv; charset=utf-8")
      .send(`﻿${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`);
  });

  /** M-Pesa requests that never became money: declined, timed out, or paid for a slot that was gone. */
  app.get("/attempts", ownerOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const f = filterSchema.pick({ from: true, to: true }).parse(req.query);
    const branchId = req.user.branchId;
    const to = f.to ?? todayString();
    const from = f.from ?? addDays(to, -29);
    const holds = await prisma.slotHold.findMany({
      where: { branchId, mpesaCheckoutId: { not: null }, status: { not: "PAID" }, createdAt: { gte: dayStart(from), lt: dayEnd(to) } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, createdAt: true, clientName: true, clientPhone: true, depositAmount: true, status: true, failureReason: true, startAt: true },
    });
    return reply.send(holds.map((h) => ({ id: h.id, at: h.createdAt, name: h.clientName, phone: h.clientPhone, amount: h.depositAmount, status: h.status, reason: h.failureReason, forSlot: h.startAt })));
  });
}

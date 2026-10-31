import { commissionFor, effectiveRate } from "../../engines/payroll/commission";
import { prisma } from "../../config/db";
import { addDays, dayEnd, dayStart, monthBounds, nairobiDateString, todayString } from "../../utils/time";

const TREND_DAYS = 14;

export async function getDashboard(branchId: string, month?: string) {
  const today = todayString();
  const anchor = month ? `${month}-01` : today;
  const { first, last } = monthBounds(anchor);

  const trendFrom = addDays(today, -(TREND_DAYS - 1));

  const [todayBookings, monthBookings, trendPayments, monthPayments, monthExpenses, refundsDue, unassigned, lowStock, openCashUps, openComplaints] =
    await Promise.all([
      prisma.booking.findMany({
        where: { branchId, startAt: { gte: dayStart(today), lt: dayEnd(today) } },
        include: { client: { select: { name: true } }, service: { select: { name: true } }, staff: { select: { id: true, name: true } } },
        orderBy: { startAt: "asc" },
      }),
      prisma.booking.findMany({
        where: { branchId, startAt: { gte: dayStart(first), lt: dayEnd(last) } },
        select: { staffId: true, serviceId: true, status: true, paid: true, price: true, discount: true, service: { select: { name: true } }, staff: { select: { name: true, payType: true, commissionPct: true } } },
      }),
      prisma.payment.findMany({
        where: { branchId, createdAt: { gte: dayStart(trendFrom), lt: dayEnd(today) } },
        select: { amount: true, createdAt: true },
      }),
      prisma.payment.findMany({
        where: { branchId, createdAt: { gte: dayStart(first), lt: dayEnd(last) } },
        select: { amount: true, method: true },
      }),
      prisma.expense.aggregate({ where: { branchId, spentAt: { gte: dayStart(first), lt: dayEnd(last) } }, _sum: { amount: true } }),
      prisma.booking.count({ where: { branchId, depositRefundDue: true } }),
      prisma.pendingPayment.count({ where: { branchId, isAssigned: false } }),
      prisma.stockItem.findMany({ where: { branchId }, select: { quantity: true, reorderAt: true } }),
      prisma.cashUp.count({ where: { branchId, locked: false } }),
      prisma.complaint.count({ where: { branchId, status: { not: "RESOLVED" } } }),
    ]);

  // ── Today ──
  const statusCount = (s: string) => todayBookings.filter((b) => b.status === s).length;
  const todayPayments = trendPayments.filter((p) => nairobiDateString(p.createdAt) === today);
  const todayRevenue = todayPayments.reduce((sum, p) => sum + p.amount, 0);

  // ── 14-day revenue trend ──
  const byDay = new Map<string, number>();
  for (let i = 0; i < TREND_DAYS; i++) byDay.set(addDays(trendFrom, i), 0);
  for (const p of trendPayments) {
    const key = nairobiDateString(p.createdAt);
    if (byDay.has(key)) byDay.set(key, byDay.get(key)! + p.amount);
  }
  const trend = [...byDay.entries()].map(([date, revenue]) => ({ date, revenue }));

  // ── Month ──
  const monthRevenue = monthPayments.reduce((sum, p) => sum + p.amount, 0);
  const expenses = monthExpenses._sum.amount ?? 0;
  const byMethod = { CASH: 0, MPESA: 0, CARD: 0 } as Record<string, number>;
  for (const p of monthPayments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;

  const overrides = await prisma.serviceCommissionOverride.findMany({ where: { staff: { branchId } } });
  const overrideMap = new Map(overrides.map((o) => [`${o.staffId}:${o.serviceId}`, o.pct]));

  let commissionOwed = 0;
  const services = new Map<string, { name: string; count: number; revenue: number }>();
  const staff = new Map<string, { name: string; count: number; revenue: number }>();

  for (const b of monthBookings) {
    if (b.status === "CANCELLED" || b.status === "NO_SHOW") continue;
    const net = b.price - b.discount;

    const s = services.get(b.serviceId) ?? { name: b.service.name, count: 0, revenue: 0 };
    s.count += 1;
    s.revenue += net;
    services.set(b.serviceId, s);

    const st = staff.get(b.staffId) ?? { name: b.staff.name, count: 0, revenue: 0 };
    st.count += 1;
    st.revenue += net;
    staff.set(b.staffId, st);

    if (b.status === "COMPLETED" && b.paid && b.staff.payType !== "SALARY_ONLY") {
      const pct = effectiveRate(b.staff.commissionPct, overrideMap.get(`${b.staffId}:${b.serviceId}`));
      commissionOwed += commissionFor(b.price, b.discount, pct);
    }
  }

  const top = (m: Map<string, { name: string; count: number; revenue: number }>) =>
    [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const now = new Date();
  const agenda = todayBookings
    .filter((b) => b.status === "CONFIRMED" || b.status === "PENDING")
    .slice(0, 8)
    .map((b) => ({
      id: b.id,
      startAt: b.startAt,
      status: b.status,
      clientName: b.client.name,
      serviceName: b.service.name,
      staffName: b.staff.name,
      isPast: b.endAt < now,
    }));

  return {
    asOf: now,
    month: anchor.slice(0, 7),
    today: {
      revenue: todayRevenue,
      bookingCount: todayBookings.length,
      upcomingCount: todayBookings.filter((b) => b.status === "CONFIRMED" || b.status === "PENDING").length,
      completedCount: statusCount("COMPLETED"),
      cancelledCount: statusCount("CANCELLED"),
      noShowCount: statusCount("NO_SHOW"),
    },
    agenda,
    trend,
    monthSummary: {
      revenue: monthRevenue,
      expenses,
      profit: monthRevenue - expenses,
      bookingCount: monthBookings.filter((b) => b.status !== "CANCELLED").length,
      commissionOwed,
      byMethod,
    },
    topServices: top(services),
    topStaff: top(staff),
    alerts: {
      refundsDue,
      unassignedPayments: unassigned,
      lowStock: lowStock.filter((i) => i.quantity <= i.reorderAt).length,
      openCashUps,
      openComplaints,
    },
  };
}

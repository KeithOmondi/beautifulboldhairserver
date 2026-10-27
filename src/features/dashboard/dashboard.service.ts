import { prisma } from "../../config/db";

export async function getDashboard(branchId: string) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // ─── Today's bookings ───
  const todayBookings = await prisma.booking.findMany({
    where: { branchId, startAt: { gte: dayStart, lte: dayEnd } },
  });

  const completedCount = todayBookings.filter((b) => b.status === "COMPLETED").length;
  const pendingCount = todayBookings.filter(
    (b) => b.status === "CONFIRMED" || b.status === "PENDING"
  ).length;
  const cancelledCount = todayBookings.filter((b) => b.status === "CANCELLED").length;

  // ─── Today's revenue (paid only) ───
  const todayPayments = await prisma.payment.findMany({
    where: { branchId, createdAt: { gte: dayStart, lte: dayEnd } },
  });
  const todayRevenue = todayPayments.reduce((sum, p) => sum + p.amount, 0);

  // ─── Month revenue ───
  const monthPayments = await prisma.payment.findMany({
    where: { branchId, createdAt: { gte: monthStart, lte: monthEnd } },
  });
  const monthRevenue = monthPayments.reduce((sum, p) => sum + p.amount, 0);

  // ─── Month bookings ───
  const monthBookings = await prisma.booking.findMany({
    where: { branchId, startAt: { gte: monthStart, lte: monthEnd } },
    include: { service: true, staff: true },
  });

  // ─── Commission owed this month ───
  let commissionOwed = 0;
  for (const booking of monthBookings) {
    if (booking.status !== "COMPLETED" || !booking.paid) continue;
    if (booking.staff.payType === "SALARY_ONLY") continue;
    const override = await prisma.serviceCommissionOverride.findUnique({
      where: { staffId_serviceId: { staffId: booking.staffId, serviceId: booking.serviceId } },
    });
    const pct = override ? override.pct : booking.staff.commissionPct || 0;
    const netPrice = booking.price - booking.discount;
    commissionOwed += Math.floor((netPrice * pct) / 10000);
  }

  // ─── Staff on duty now ───
  const activeShifts = await prisma.shift.findMany({
    where: { branchId, startAt: { lte: now }, endAt: { gte: now } },
    include: { staff: true },
  });
  const staffOnDuty = activeShifts.map((s) => ({
    id: s.staff.id,
    name: s.staff.name,
    role: s.staff.role,
    shiftEndsAt: s.endAt,
  }));

  // ─── Top services this month ───
  const serviceMap = new Map<string, { name: string; count: number; revenue: number }>();
  for (const booking of monthBookings) {
    if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") continue;
    const key = booking.serviceId;
    const existing = serviceMap.get(key) ?? {
      name: booking.service.name,
      count: 0,
      revenue: 0,
    };
    existing.count += 1;
    existing.revenue += booking.price - booking.discount;
    serviceMap.set(key, existing);
  }
  const topServices = Array.from(serviceMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // ─── Cash-up status ───
  const pendingCashUps = await prisma.cashUp.count({
    where: { branchId, locked: false },
  });

  const lastCashUp = await prisma.cashUp.findFirst({
    where: { branchId },
    orderBy: { businessDate: "desc" },
  });

  return {
    today: {
      revenue: todayRevenue,
      bookingCount: todayBookings.length,
      completedCount,
      pendingCount,
      cancelledCount,
    },
    month: {
      revenue: monthRevenue,
      bookingCount: monthBookings.length,
      commissionOwed,
    },
    staffOnDuty,
    topServices,
    pendingCashUps,
    lastCashUp: {
      date: lastCashUp?.businessDate ?? null,
      difference: lastCashUp?.difference ?? 0,
    },
  };
}
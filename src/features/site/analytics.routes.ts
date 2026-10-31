import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { addDays, dayEnd, dayStart, getMinutesFromMidnight, nairobiDateString, todayString } from "../../utils/time";
import { requires } from "../../utils/access";

const querySchema = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), "days must be 7, 30 or 90").default(30) });

const FUNNEL = [
  { type: "page_view", label: "Visited the website" },
  { type: "service_selected", label: "Chose a service" },
  { type: "slot_selected", label: "Picked a time" },
  { type: "details_view", label: "Reached the details form" },
  { type: "booking_submitted", label: "Submitted a booking" },
  { type: "booking_confirmed", label: "Booking confirmed" },
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  app.get("/", { preHandler: [authorize("OWNER", "MANAGER"), requires("reports")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { days } = querySchema.parse(req.query);
    const branchId = req.user.branchId;
    const today = todayString();
    const fromDate = addDays(today, -(days - 1));
    const from = dayStart(fromDate);
    const to = dayEnd(today);

    // ── Website traffic ──
    const [events, visitorsByDay] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: { type: true, path: true, sessionId: true, referrer: true, device: true },
      }),
      prisma.$queryRaw<Array<{ day: string; visitors: bigint }>>`
        SELECT to_char(("createdAt" AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT "sessionId") AS visitors
        FROM "AnalyticsEvent"
        WHERE "type" = 'page_view' AND "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 1 ORDER BY 1`,
    ]);

    const sessionsBy = (type: string) => new Set(events.filter((e) => e.type === type).map((e) => e.sessionId));
    const visitors = sessionsBy("page_view").size;
    const funnel = FUNNEL.map((f) => ({ label: f.label, count: sessionsBy(f.type).size }));

    const firstEvent = new Map<string, { referrer: string | null; device: string | null }>();
    for (const e of events) if (!firstEvent.has(e.sessionId)) firstEvent.set(e.sessionId, { referrer: e.referrer, device: e.device });
    const count = (pick: (v: { referrer: string | null; device: string | null }) => string) => {
      const m = new Map<string, number>();
      for (const v of firstEvent.values()) m.set(pick(v), (m.get(pick(v)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const sources = count((v) => v.referrer ?? "Direct / link shared").slice(0, 6).map(([name, visitors]) => ({ name, visitors }));
    const devices = count((v) => v.device ?? "unknown").map(([name, visitors]) => ({ name, visitors }));

    const series = new Map(visitorsByDay.map((r) => [r.day, Number(r.visitors)]));
    const dailyVisitors = Array.from({ length: days }, (_, i) => {
      const date = addDays(fromDate, i);
      return { date, visitors: series.get(date) ?? 0 };
    });

    // ── Business ──
    const bookings = await prisma.booking.findMany({
      where: { branchId, startAt: { gte: from, lt: to } },
      select: {
        status: true, source: true, startAt: true, price: true, discount: true, clientId: true,
        service: { select: { name: true } }, staff: { select: { name: true } },
      },
      take: 5000,
    });
    const live = bookings.filter((b) => b.status !== "CANCELLED");
    const done = bookings.filter((b) => b.status === "COMPLETED");
    const net = (b: { price: number; discount: number }) => b.price - b.discount;

    const byWeekday = WEEKDAYS.map((label, i) => ({ label, bookings: live.filter((b) => new Date(`${nairobiDateString(b.startAt)}T00:00:00Z`).getUTCDay() === i).length }));
    const hourCounts = new Map<number, number>();
    for (const b of live) {
      const h = Math.floor(getMinutesFromMidnight(b.startAt) / 60);
      hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    }
    const byHour = [...hourCounts.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => ({ label: `${String(h).padStart(2, "0")}:00`, bookings: n }));

    const group = (key: (b: (typeof done)[number]) => string) => {
      const m = new Map<string, { name: string; count: number; revenue: number }>();
      for (const b of done) {
        const k = key(b);
        const row = m.get(k) ?? { name: k, count: 0, revenue: 0 };
        row.count += 1;
        row.revenue += net(b);
        m.set(k, row);
      }
      return [...m.values()].sort((a, b) => b.revenue - a.revenue);
    };

    const clientIds = [...new Set(live.map((b) => b.clientId))];
    const returningIds = clientIds.length
      ? new Set((await prisma.booking.findMany({ where: { clientId: { in: clientIds }, startAt: { lt: from }, status: { not: "CANCELLED" } }, select: { clientId: true }, distinct: ["clientId"] })).map((r) => r.clientId))
      : new Set<string>();

    const decided = bookings.filter((b) => b.status === "COMPLETED" || b.status === "NO_SHOW").length;
    const online = live.filter((b) => b.source === "ONLINE").length;
    const confirmedOnline = funnel[5]!.count;

    return reply.send({
      days,
      traffic: {
        visitors,
        conversionRate: visitors > 0 ? Math.round((confirmedOnline / visitors) * 1000) / 10 : null,
        funnel,
        sources,
        devices,
        dailyVisitors,
      },
      business: {
        bookings: live.length,
        onlineShare: live.length ? Math.round((online / live.length) * 100) : null,
        noShowRate: decided ? Math.round((bookings.filter((b) => b.status === "NO_SHOW").length / decided) * 100) : null,
        newClients: clientIds.filter((id) => !returningIds.has(id)).length,
        returningClients: clientIds.filter((id) => returningIds.has(id)).length,
        byWeekday,
        byHour,
        byService: group((b) => b.service.name).slice(0, 8),
        byStylist: group((b) => b.staff.name).slice(0, 8),
      },
    });
  });
}

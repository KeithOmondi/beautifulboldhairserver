import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { atMinutes, dayEnd, dayStart, hhmmToMinutes, todayString } from "../../utils/time";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const TIME_OFF_KINDS = ["LEAVE", "OFF_DAY", "EMERGENCY", "SICK", "HOLIDAY"] as const;

const createSchema = z
  .object({
    /** Omit for a salon-wide closure (public holiday, renovation). */
    staffId: z.string().cuid().optional(),
    kind: z.enum(TIME_OFF_KINDS).default("OFF_DAY"),
    from: date,
    to: date,
    /** Optional hours for a part-day absence (single day only). Leave both out for the whole day. */
    startTime: time.optional(),
    endTime: time.optional(),
    reason: z.string().trim().max(120).optional(),
  })
  .refine((d) => d.to >= d.from, { message: "End date must be on or after the start date", path: ["to"] })
  .refine((d) => Boolean(d.startTime) === Boolean(d.endTime), { message: "Give both a start and an end time, or neither", path: ["endTime"] })
  .refine((d) => !d.startTime || d.from === d.to, { message: "Part-day time off must be a single day", path: ["to"] })
  .refine((d) => !d.startTime || !d.endTime || d.endTime > d.startTime, { message: "End time must be after the start time", path: ["endTime"] });

export async function timeOffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);
  const managers = { preHandler: [authorize("OWNER", "MANAGER")] };

  const clashes = (branchId: string, staffId: string | null, startAt: Date, endAt: Date) =>
    prisma.booking.findMany({
      where: {
        branchId,
        ...(staffId ? { staffId } : {}),
        status: { in: ["CONFIRMED", "PENDING"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, startAt: true, client: { select: { name: true, phone: true } }, service: { select: { name: true } }, staff: { select: { name: true } } },
      orderBy: { startAt: "asc" },
    });

  // Upcoming and current time off, each with the bookings it collides with so the owner can rebook them.
  app.get("/", async (req: FastifyRequest, reply: FastifyReply) => {
    const branchId = req.user.branchId;
    const rows = await prisma.timeOff.findMany({
      where: { branchId, endAt: { gte: dayStart(todayString()) } },
      include: { staff: { select: { name: true } } },
      orderBy: { startAt: "asc" },
    });
    const withClashes = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        affectedBookings: (await clashes(branchId, r.staffId, r.startAt, r.endAt)).map((b) => ({
          id: b.id,
          startAt: b.startAt,
          clientName: b.client.name,
          clientPhone: b.client.phone,
          service: b.service.name,
          staffName: b.staff.name,
        })),
      })),
    );
    return reply.send(withClashes);
  });

  app.post("/", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = createSchema.parse(req.body);
    const branchId = req.user.branchId;

    if (data.staffId) {
      const staff = await prisma.staff.findFirst({ where: { id: data.staffId, branchId } });
      if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");
    }

    let startAt = dayStart(data.from);
    let endAt = dayEnd(data.to);
    if (data.startTime && data.endTime) {
      startAt = atMinutes(data.from, hhmmToMinutes(data.startTime));
      endAt = atMinutes(data.from, hhmmToMinutes(data.endTime));
    } else if (data.kind === "EMERGENCY" && data.from === todayString()) {
      // An emergency starts right now, so clients can't grab a slot that is about to be missed.
      startAt = new Date();
    }

    const clashing = await clashes(branchId, data.staffId ?? null, startAt, endAt);

    const row = await prisma.timeOff.create({
      data: { branchId, staffId: data.staffId ?? null, kind: data.kind, startAt, endAt, reason: data.reason ?? null },
    });
    return reply.status(201).send({
      ...row,
      clashingBookings: clashing.length,
      affectedBookings: clashing.map((b) => ({
        id: b.id,
        startAt: b.startAt,
        clientName: b.client.name,
        clientPhone: b.client.phone,
        service: b.service.name,
        staffName: b.staff.name,
      })),
    });
  });

  app.delete("/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.timeOff.findFirst({ where: { id, branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Time off not found", "NOT_FOUND");
    await prisma.timeOff.delete({ where: { id } });
    return reply.send({ message: "Time off removed" });
  });
}


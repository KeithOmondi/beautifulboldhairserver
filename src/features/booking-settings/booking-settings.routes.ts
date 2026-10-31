import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../config/db";
import type { OpeningHours } from "../../utils/opening-hours";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { accessFor } from "../../utils/access";
import { AppError } from "../../utils/errors";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dayHours = z.object({ start: hhmm, end: hhmm }).refine((d) => d.end > d.start, { message: "Closing time must be after opening time" });
const openingSchema = z
  .record(z.string().regex(/^[0-6]$/), dayHours.nullable())
  .refine((o) => Object.values(o).some(Boolean), { message: "Open at least one day, or leave opening hours unset" });

const updateSchema = z.object({
  /** Salon opening days and hours. Send null to remove the limit. */
  openingHours: openingSchema.nullable().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  tagline: z.string().trim().max(140).nullable().optional(),
  about: z.string().trim().max(1200).nullable().optional(),
  instagram: z.string().trim().max(60).nullable().optional(),
  whatsapp: z.string().trim().max(30).nullable().optional(),
  hoursText: z.string().trim().max(300).nullable().optional(),
  announcement: z.string().trim().max(140).nullable().optional(),
  minNoticeHours: z.number().int().min(0).max(168).optional(),
  maxAheadDays: z.number().int().min(1).max(365).optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  cancelWindowHours: z.number().int().min(0).max(168).optional(),
  depositRequired: z.boolean().optional(),
  depositAmount: z.number().int().min(0).max(1_000_000).optional(),
  maxBookingsPerDay: z.number().int().min(1).max(10).optional(),
  showStylists: z.boolean().optional(),
  shopDeliveryFee: z.number().int().min(0).max(100_000).optional(),
  shopFreeOver: z.number().int().min(0).max(10_000_000).nullable().optional(),
  shopCodAllowed: z.boolean().optional(),
  // What managers may do. Only an owner can change these.
  mgrReports: z.boolean().optional(),
  mgrRefunds: z.boolean().optional(),
  mgrCashUp: z.boolean().optional(),
  mgrStaffPay: z.boolean().optional(),
});

async function load(branchId: string) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId }, include: { settings: true } });
  const s = branch.settings;
  return {
    name: branch.name,
    phone: branch.phone,
    address: branch.address,
    tagline: branch.tagline,
    about: branch.about,
    instagram: branch.instagram,
    whatsapp: branch.whatsapp,
    hoursText: branch.hoursText,
    announcement: branch.announcement,
    openingHours: (s?.openingHours ?? null) as OpeningHours | null,
    minNoticeHours: s?.minNoticeHours ?? 3,
    maxAheadDays: s?.maxAheadDays ?? 60,
    bufferMinutes: s?.bufferMinutes ?? 15,
    cancelWindowHours: s?.cancelWindowHours ?? 24,
    depositRequired: s?.depositRequired ?? false,
    depositAmount: s?.depositAmount ?? 0,
    maxBookingsPerDay: s?.maxBookingsPerDay ?? 2,
    showStylists: s?.showStylists ?? false,
    shopDeliveryFee: s?.shopDeliveryFee ?? 0,
    shopFreeOver: s?.shopFreeOver ?? null,
    shopCodAllowed: s?.shopCodAllowed ?? true,
    mgrReports: s?.mgrReports ?? true,
    mgrRefunds: s?.mgrRefunds ?? false,
    mgrCashUp: s?.mgrCashUp ?? true,
    mgrStaffPay: s?.mgrStaffPay ?? false,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // What the signed-in person may do in this branch, so the app can hide what they can't use.
  app.get("/access", async (req: FastifyRequest, reply: FastifyReply) => reply.send(await accessFor(req.user)));

  app.get("/", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await load(req.user.branchId));
  });

  app.patch("/", { preHandler: [authorize("OWNER", "MANAGER")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { name, phone, address, tagline, about, instagram, whatsapp, hoursText, announcement, openingHours, ...rest } = updateSchema.parse(req.body);
    // Permissions for managers are the owner's to give: a manager cannot widen their own access.
    if (req.user.role !== "OWNER" && ("mgrReports" in rest || "mgrRefunds" in rest || "mgrCashUp" in rest || "mgrStaffPay" in rest)) {
      throw new AppError(403, "Only the owner can change what managers may do", "FORBIDDEN");
    }
    const branchId = req.user.branchId;
    // Drop undefined keys (exactOptionalPropertyTypes) so only submitted fields change.
    const booking = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, number | boolean>;

    await prisma.$transaction(async (tx) => {
      const branchData: Record<string, unknown> = {};
      if (name !== undefined) branchData.name = name;
      if (phone !== undefined) branchData.phone = phone;
      if (address !== undefined) branchData.address = address;
      if (tagline !== undefined) branchData.tagline = tagline;
      if (about !== undefined) branchData.about = about;
      if (instagram !== undefined) branchData.instagram = instagram?.replace(/^@/, "") ?? null;
      if (whatsapp !== undefined) branchData.whatsapp = whatsapp;
      if (hoursText !== undefined) branchData.hoursText = hoursText;
      if (announcement !== undefined) branchData.announcement = announcement || null;
      if (Object.keys(branchData).length) await tx.branch.update({ where: { id: branchId }, data: branchData });

      const opening = openingHours === undefined ? {} : { openingHours: openingHours === null ? Prisma.DbNull : openingHours };
      await tx.bookingSettings.upsert({
        where: { branchId },
        update: { ...booking, ...opening },
        create: { branchId, ...booking, ...opening },
      });
    });
    return reply.send(await load(branchId));
  });
}

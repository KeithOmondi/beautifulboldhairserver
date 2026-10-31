import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../config/db";
import { cloudinaryEnabled } from "../../config/env";
import { createUploadSignature, destroyAsset, isOwnAsset } from "../../integrations/cloudinary";
import { AppError } from "../../utils/errors";
import { dayEnd, dayStart } from "../../utils/time";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

/* ─── Home page banners ───────────────────────────────────────────────── */

const photo = z.string().url().max(500).startsWith("https://res.cloudinary.com/", "Upload the picture through the banner form");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const heroSchema = z
  .object({
    kind: z.enum(["DESIGNED", "PHOTO_TEXT"]),
    imageUrl: photo,
    mobileImageUrl: photo.nullable().optional(),
    eyebrow: optText(40),
    headline: optText(90),
    subtext: optText(220),
    buttonLabel: optText(30),
    // A page on this site, a section on the home page, or a secure web address. Nothing else, so a banner can't run a script.
    linkTo: z.string().trim().max(300).regex(/^(\/[^\s]*|#[\w-]+|https:\/\/[^\s]+)$/, "Use a page like /book, a section like #services, or an https:// link").nullable().optional(),
    align: z.enum(["left", "center"]).default("left"),
    overlay: z.number().int().min(0).max(80).default(45),
    isActive: z.boolean().default(true),
    startsOn: day,
    endsOn: day,
  })
  .refine((d) => d.kind === "DESIGNED" || Boolean(d.headline?.trim()), { message: "Give the banner a headline", path: ["headline"] })
  .refine((d) => !d.buttonLabel?.trim() || Boolean(d.linkTo), { message: "Choose where the button goes", path: ["linkTo"] })
  .refine((d) => !d.startsOn || !d.endsOn || d.endsOn >= d.startsOn, { message: "The end date must be on or after the start date", path: ["endsOn"] });

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
function heroData(d: z.infer<typeof heroSchema>) {
  return {
    kind: d.kind,
    imageUrl: d.imageUrl,
    mobileImageUrl: d.mobileImageUrl ?? null,
    // A designed banner carries its own words, so any text fields are ignored for it.
    eyebrow: d.kind === "DESIGNED" ? null : blank(d.eyebrow),
    headline: d.kind === "DESIGNED" ? null : blank(d.headline),
    subtext: d.kind === "DESIGNED" ? null : blank(d.subtext),
    buttonLabel: d.kind === "DESIGNED" ? null : blank(d.buttonLabel),
    linkTo: blank(d.linkTo),
    align: d.align,
    overlay: d.overlay,
    isActive: d.isActive,
    startsAt: d.startsOn ? dayStart(d.startsOn) : null,
    endsAt: d.endsOn ? dayEnd(d.endsOn) : null,
  };
}

/* ─── Gallery ─────────────────────────────────────────────────────────── */

const registerSchema = z.object({
  publicId: z.string().min(5).max(200),
  url: z.string().url().max(500),
  caption: z.string().trim().max(120).optional(),
});
const patchGallerySchema = z.object({
  caption: z.string().trim().max(120).nullable().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

/* ─── Complaints & reviews ────────────────────────────────────────────── */

const patchComplaintSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  resolutionNote: z.string().trim().max(1000).nullable().optional(),
});

export async function siteStaffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);
  const managers = { preHandler: [authorize("OWNER", "MANAGER")] };
  const frontDesk = { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST")] };

  // — Gallery —
  app.get("/gallery", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const images = await prisma.galleryImage.findMany({
      where: { branchId: req.user.branchId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
    return reply.send({ enabled: cloudinaryEnabled, images });
  });

  app.post("/gallery/sign", managers, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!cloudinaryEnabled) throw new AppError(503, "Image uploads are not set up yet. Add your Cloudinary details to the server settings.", "UPLOADS_DISABLED");
    return reply.send(createUploadSignature());
  });

  app.post("/gallery", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = registerSchema.parse(req.body);
    if (!isOwnAsset(data.publicId, data.url)) throw new AppError(400, "That image did not come from our upload service", "BAD_REQUEST");
    const count = await prisma.galleryImage.count({ where: { branchId: req.user.branchId } });
    if (count >= 60) throw new AppError(400, "The gallery is full (60 photos). Delete some to add more.", "LIMIT");
    const image = await prisma.galleryImage.create({
      data: { branchId: req.user.branchId, publicId: data.publicId, url: data.url, caption: data.caption ?? null, sortOrder: count },
    });
    return reply.status(201).send(image);
  });

  app.patch("/gallery/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = patchGallerySchema.parse(req.body);
    const found = await prisma.galleryImage.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Photo not found", "NOT_FOUND");
    const update = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    return reply.send(await prisma.galleryImage.update({ where: { id: found.id }, data: update }));
  });

  app.delete("/gallery/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.galleryImage.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Photo not found", "NOT_FOUND");
    await prisma.galleryImage.delete({ where: { id: found.id } });
    void destroyAsset(found.publicId);
    return reply.send({ message: "Photo deleted" });
  });

  // — Complaints —
  app.get("/complaints", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const { status } = req.query as { status?: string };
    const rows = await prisma.complaint.findMany({
      where: { branchId: req.user.branchId, ...(status && ["OPEN", "IN_PROGRESS", "RESOLVED"].includes(status) ? { status: status as "OPEN" } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: { booking: { select: { startAt: true, service: { select: { name: true } } } } },
    });
    return reply.send(rows);
  });

  app.patch("/complaints/:id", frontDesk, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = patchComplaintSchema.parse(req.body);
    const found = await prisma.complaint.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Complaint not found", "NOT_FOUND");
    const resolving = data.status === "RESOLVED" && found.status !== "RESOLVED";
    const updated = await prisma.complaint.update({
      where: { id: found.id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.resolutionNote !== undefined ? { resolutionNote: data.resolutionNote } : {}),
        ...(resolving ? { resolvedAt: new Date(), resolvedBy: req.user.sub } : {}),
        ...(data.status && data.status !== "RESOLVED" ? { resolvedAt: null, resolvedBy: null } : {}),
      },
    });
    return reply.send(updated);
  });

  // — Home page banners —
  app.get("/hero", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await prisma.heroSlide.findMany({ where: { branchId: req.user.branchId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }));
  });

  app.post("/hero", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const d = heroSchema.parse(req.body);
    const branchId = req.user.branchId;
    const count = await prisma.heroSlide.count({ where: { branchId } });
    if (count >= 8) throw new AppError(400, "You can have up to 8 banners. Remove one to add another.", "LIMIT");
    const created = await prisma.heroSlide.create({ data: { ...heroData(d), branchId, sortOrder: count } });
    return reply.status(201).send(created);
  });

  // Same order the owner sees in the list, top to bottom.
  app.put("/hero/order", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { ids } = z.object({ ids: z.array(z.string()).max(8) }).parse(req.body);
    const own = await prisma.heroSlide.findMany({ where: { branchId: req.user.branchId, id: { in: ids } }, select: { id: true } });
    if (own.length !== ids.length) throw new AppError(400, "Unknown banner in the list", "BAD_REQUEST");
    await prisma.$transaction(ids.map((id, i) => prisma.heroSlide.update({ where: { id }, data: { sortOrder: i } })));
    return reply.send({ message: "Order saved" });
  });

  app.patch("/hero/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const d = heroSchema.parse(req.body);
    const found = await prisma.heroSlide.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Banner not found", "NOT_FOUND");
    return reply.send(await prisma.heroSlide.update({ where: { id: found.id }, data: heroData(d) }));
  });

  app.delete("/hero/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.heroSlide.findFirst({ where: { id: idOf(req), branchId: req.user.branchId } });
    if (!found) throw new AppError(404, "Banner not found", "NOT_FOUND");
    await prisma.heroSlide.delete({ where: { id: found.id } });
    return reply.send({ message: "Banner removed" });
  });

  // — Reviews —
  app.get("/reviews", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const rows = await prisma.feedback.findMany({
      where: { client: { branchId: req.user.branchId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, rating: true, comment: true, isPublished: true, verifiedAt: true, removedAt: true, removalReason: true, createdAt: true,
        client: { select: { name: true } },
        booking: { select: { service: { select: { name: true } }, staff: { select: { name: true } } } },
      },
    });
    return reply.send(rows);
  });

  // Show or hide a review on the website. Managers and the owner can do this.
  app.patch("/reviews/:id", managers, async (req: FastifyRequest, reply: FastifyReply) => {
    const { isPublished } = z.object({ isPublished: z.boolean() }).parse(req.body);
    const found = await prisma.feedback.findFirst({ where: { id: idOf(req), client: { branchId: req.user.branchId } } });
    if (!found) throw new AppError(404, "Review not found", "NOT_FOUND");
    if (found.removedAt) throw new AppError(409, "This review was rejected. Restore it first.", "REMOVED");
    const updated = await prisma.feedback.update({ where: { id: found.id }, data: { isPublished } });
    await prisma.auditLog.create({
      data: { action: "UPDATE", entity: "Feedback", entityId: found.id, branchId: req.user.branchId, actorId: req.user.sub, before: { isPublished: found.isPublished }, after: { isPublished }, ipAddress: req.ip },
    });
    return reply.send(updated);
  });

  // Reject a review as fake or abusive (owner only). It stops counting toward the rating and is never shown. Reversible.
  app.post("/reviews/:id/reject", { preHandler: [authorize("OWNER")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(200) }).parse(req.body);
    const found = await prisma.feedback.findFirst({ where: { id: idOf(req), client: { branchId: req.user.branchId } } });
    if (!found) throw new AppError(404, "Review not found", "NOT_FOUND");
    const updated = await prisma.feedback.update({ where: { id: found.id }, data: { removedAt: new Date(), removedBy: req.user.sub, removalReason: reason, isPublished: false } });
    await prisma.auditLog.create({
      data: { action: "UPDATE", entity: "Feedback", entityId: found.id, branchId: req.user.branchId, actorId: req.user.sub, before: { rating: found.rating, removed: false }, after: { removed: true, reason }, ipAddress: req.ip },
    });
    return reply.send(updated);
  });

  app.post("/reviews/:id/restore", { preHandler: [authorize("OWNER")] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await prisma.feedback.findFirst({ where: { id: idOf(req), client: { branchId: req.user.branchId } } });
    if (!found) throw new AppError(404, "Review not found", "NOT_FOUND");
    const updated = await prisma.feedback.update({ where: { id: found.id }, data: { removedAt: null, removedBy: null, removalReason: null } });
    await prisma.auditLog.create({
      data: { action: "UPDATE", entity: "Feedback", entityId: found.id, branchId: req.user.branchId, actorId: req.user.sub, before: { removed: true }, after: { removed: false }, ipAddress: req.ip },
    });
    return reply.send(updated);
  });
}

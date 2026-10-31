import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { currentPrice } from "../../utils/money";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/db";
import { env } from "../../config/env";
import { optimizedUrl } from "../../integrations/cloudinary";
import { sendSms } from "../../integrations/sms";
import { AppError } from "../../utils/errors";
import { summarizeOpening, type OpeningHours } from "../../utils/opening-hours";
import { normalizePhone } from "../../utils/phone";
import { getBranchById, getPublicBranch, listPublicBranches } from "../public-booking/public-booking.service";

const firstNameAndInitial = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!;
};

/* ─── Landing page data: one request, cacheable ───────────────────────── */

async function landing(_req: FastifyRequest, reply: FastifyReply) {
  const branch = await getPublicBranch();

  const since = new Date(Date.now() - 90 * 86_400_000);
  const now = new Date();
  const [services, gallery, reviews, rating, spread, slides, booked] = await Promise.all([
    prisma.service.findMany({
      where: { branchId: branch.id, isActive: true },
      select: { id: true, name: true, description: true, durationMin: true, price: true, salePrice: true, category: true, imageUrl: true },
      orderBy: [{ price: "asc" }, { name: "asc" }],
    }),
    prisma.galleryImage.findMany({
      where: { branchId: branch.id, isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 24,
    }),
    prisma.feedback.findMany({
      where: { isPublished: true, removedAt: null, rating: { gte: 4 }, client: { branchId: branch.id } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, rating: true, comment: true, createdAt: true, client: { select: { name: true } } },
    }),
    prisma.feedback.aggregate({ where: { removedAt: null, client: { branchId: branch.id } }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.feedback.groupBy({ by: ["rating"], where: { removedAt: null, client: { branchId: branch.id } }, _count: { _all: true } }),
    prisma.heroSlide.findMany({
      where: { branchId: branch.id, isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 8,
    }),
    prisma.booking.groupBy({ by: ["serviceId"], where: { branchId: branch.id, status: { in: ["CONFIRMED", "COMPLETED"] }, startAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { serviceId: "desc" } }, take: 2 }),
  ]);

  reply.header("Cache-Control", "public, max-age=60");
  const branches = await listPublicBranches();
  return reply.send({
    branch: branch.slug,
    branches,
    salon: {
      name: branch.name,
      tagline: branch.tagline,
      about: branch.about,
      phone: branch.phone,
      address: branch.address,
      instagram: branch.instagram,
      whatsapp: branch.whatsapp,
      hoursText: summarizeOpening(branch.settings?.openingHours as OpeningHours | null) ?? branch.hoursText,
    },
    announcement: branch.announcement,
    hero: slides.map((h) => ({
      id: h.id,
      kind: h.kind,
      image: optimizedUrl(h.imageUrl, 1920),
      mobileImage: h.mobileImageUrl ? optimizedUrl(h.mobileImageUrl, 900) : null,
      eyebrow: h.eyebrow,
      headline: h.headline,
      subtext: h.subtext,
      buttonLabel: h.buttonLabel,
      linkTo: h.linkTo,
      align: h.align,
      overlay: h.overlay,
    })),
    cancelWindowHours: branch.settings?.cancelWindowHours ?? 24,
    depositRequired: Boolean(branch.settings?.depositRequired && (branch.settings?.depositAmount ?? 0) > 0),
    // The two services booked most in the last 90 days, once there are enough bookings for that to mean something.
    popularServiceIds: booked.filter((b) => b._count._all >= 3).map((b) => b.serviceId),
    services: services.map(({ salePrice, imageUrl, ...r }) => {
      const today = currentPrice({ price: r.price, salePrice });
      return { ...r, price: today, wasPrice: today < r.price ? r.price : null, image: imageUrl ? optimizedUrl(imageUrl, 640) : null };
    }),
    gallery: gallery.map((g) => ({ id: g.id, caption: g.caption, likes: g.likeCount, thumb: optimizedUrl(g.url, 640), full: optimizedUrl(g.url, 1600) })),
    reviews: reviews
      .filter((r) => r.comment && r.comment.trim().length > 0)
      .map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, name: firstNameAndInitial(r.client.name), date: r.createdAt })),
    rating:
      rating._count._all >= 3
        ? {
            average: Math.round((rating._avg.rating ?? 0) * 10) / 10,
            count: rating._count._all,
            // How many reviews gave 5, 4, 3, 2 and 1 stars (index 0 = 5 stars).
            spread: [5, 4, 3, 2, 1].map((n) => spread.find((s) => s.rating === n)?._count._all ?? 0),
          }
        : null,
  });
}

/* ─── Gallery likes ───────────────────────────────────────────────────── */

const likeSchema = z.object({ action: z.enum(["like", "unlike"]) });

async function likePhoto(req: FastifyRequest, reply: FastifyReply) {
  const { action } = likeSchema.parse(req.body);
  const { id } = req.params as { id: string };
  const branch = await getPublicBranch();
  const photo = await prisma.galleryImage.findFirst({ where: { id, branchId: branch.id, isPublished: true }, select: { id: true } });
  if (!photo) throw new AppError(404, "Photo not found", "NOT_FOUND");

  // The browser remembers what a visitor already liked; the floor of 0 keeps the counter sane regardless.
  const updated =
    action === "like"
      ? await prisma.galleryImage.update({ where: { id }, data: { likeCount: { increment: 1 } }, select: { likeCount: true } })
      : (await prisma.galleryImage.updateMany({ where: { id, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } }),
        await prisma.galleryImage.findUniqueOrThrow({ where: { id }, select: { likeCount: true } }));
  return reply.send({ likes: updated.likeCount });
}

/* ─── Reviews ─────────────────────────────────────────────────────────── */

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(600).optional(),
  /** Proof that the client confirmed the code sent to the phone on the booking. */
  key: z.string().max(200).optional(),
});

/**
 * Reviews are tied to one real visit and to the phone that booked it.
 * Opening the link is not enough: the client must type a code we SMS to the number on the booking,
 * so a forwarded link is useless to anyone who doesn't hold that phone.
 */
const REVIEW_WINDOW_DAYS = 30;
const CODE_TTL_MIN = 10;
const MAX_CODE_TRIES = 5;
const KEY_TTL_MIN = 30;

const hashCode = (code: string, bookingId: string) =>
  createHash("sha256").update(`${code}:${bookingId}:${env.JWT_SECRET}`).digest("hex");

const signKey = (bookingId: string, exp: number) =>
  createHmac("sha256", env.JWT_SECRET).update(`review:${bookingId}:${exp}`).digest("hex");

function issueReviewKey(bookingId: string) {
  const exp = Date.now() + KEY_TTL_MIN * 60_000;
  return `${exp}.${signKey(bookingId, exp)}`;
}

function reviewKeyValid(bookingId: string, key: unknown) {
  if (typeof key !== "string") return false;
  const [expStr, sig] = key.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(signKey(bookingId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const maskPhone = (phone: string) => (phone.length > 4 ? `${phone.slice(0, 3)}••• ••${phone.slice(-3)}` : "your phone");

async function bookingForReview(token: string) {
  const booking = await prisma.booking.findUnique({
    where: { manageToken: token },
    include: { service: { select: { name: true } }, client: { select: { name: true, phone: true } }, feedback: { select: { id: true } } },
  });
  if (!booking) throw new AppError(404, "We could not find that appointment", "NOT_FOUND");
  return booking;
}

const withinWindow = (endAt: Date) => Date.now() - endAt.getTime() < REVIEW_WINDOW_DAYS * 86_400_000;

async function getReview(req: FastifyRequest, reply: FastifyReply) {
  const b = await bookingForReview((req.params as { token: string }).token);
  const branch = await getBranchById(b.branchId);
  reply.header("Cache-Control", "no-store");
  return reply.send({
    salonName: branch.name,
    clientName: b.client.name.split(" ")[0],
    serviceName: b.service.name,
    date: b.startAt,
    canReview: b.status === "COMPLETED" && !b.feedback && withinWindow(b.endAt),
    expired: b.status === "COMPLETED" && !b.feedback && !withinWindow(b.endAt),
    alreadyReviewed: Boolean(b.feedback),
    maskedPhone: maskPhone(b.client.phone),
  });
}

async function sendReviewCode(req: FastifyRequest, reply: FastifyReply) {
  const b = await bookingForReview((req.params as { token: string }).token);
  if (b.status !== "COMPLETED" || b.feedback || !withinWindow(b.endAt)) throw new AppError(400, "This review link is no longer active", "BAD_REQUEST");

  const recent = await prisma.otpCode.findMany({ where: { phone: b.client.phone, createdAt: { gt: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: "desc" } });
  if (recent.length >= 3) throw new AppError(429, "Too many codes requested. Please try again in an hour.", "RATE_LIMITED");
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) throw new AppError(429, "Please wait a minute before asking for another code.", "RATE_LIMITED");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: { phone: b.client.phone, code: hashCode(code, b.id), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
  });
  const name = (await getBranchById(b.branchId)).name;
  await sendSms(b.client.phone, `${name}: your review code is ${code}. It expires in ${CODE_TTL_MIN} minutes. Never share it with anyone.`, "review_code");
  return reply.send({ sentTo: maskPhone(b.client.phone) });
}

async function verifyReviewCode(req: FastifyRequest, reply: FastifyReply) {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
  const b = await bookingForReview((req.params as { token: string }).token);
  if (b.status !== "COMPLETED" || b.feedback || !withinWindow(b.endAt)) throw new AppError(400, "This review link is no longer active", "BAD_REQUEST");

  const otp = await prisma.otpCode.findFirst({
    where: { phone: b.client.phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= MAX_CODE_TRIES) throw new AppError(400, "That code has expired. Please ask for a new one.", "CODE_EXPIRED");

  const given = Buffer.from(hashCode(code, b.id));
  const stored = Buffer.from(otp.code);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, "That code isn't right. Check the SMS and try again.", "CODE_INVALID");
  }
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  return reply.send({ key: issueReviewKey(b.id) });
}

async function postReview(req: FastifyRequest, reply: FastifyReply) {
  const { rating, comment, key } = reviewSchema.parse(req.body);
  const b = await bookingForReview((req.params as { token: string }).token);
  if (b.status !== "COMPLETED") throw new AppError(400, "You can review an appointment once it is complete", "BAD_REQUEST");
  if (!withinWindow(b.endAt)) throw new AppError(410, "This review link has expired", "EXPIRED");
  if (b.feedback) throw new AppError(409, "Thank you, we already have your review for this visit", "ALREADY_REVIEWED");
  if (!reviewKeyValid(b.id, key)) throw new AppError(403, "Please confirm the code we texted to the number on the booking first.", "NOT_VERIFIED");

  await prisma.$transaction(async (tx) => {
    await tx.feedback.create({ data: { clientId: b.clientId, bookingId: b.id, rating, comment: comment || null, verifiedAt: new Date() } });
    // A poor rating must never sit unseen: it also opens a complaint for the team to follow up.
    if (rating <= 2) {
      await tx.complaint.create({
        data: {
          branchId: b.branchId,
          bookingId: b.id,
          clientId: b.clientId,
          name: b.client.name,
          phone: b.client.phone,
          category: "SERVICE",
          message: `Low rating (${rating}/5)${comment ? `: ${comment}` : ""}`,
        },
      });
    }
  });
  return reply.status(201).send({ message: "Thank you for your feedback" });
}

/* ─── Complaints / contact ────────────────────────────────────────────── */

const complaintSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  phone: z.string().regex(/^(?:\+?254|0)([17]\d{8})$/, "Enter a valid Kenyan phone number"),
  category: z.enum(["SERVICE", "STAFF", "PAYMENT", "BOOKING", "OTHER"]).default("OTHER"),
  message: z.string().trim().min(10, "Please tell us a little more (at least 10 characters)").max(1000),
  manageToken: z.string().regex(/^[0-9a-f]{48}$/).optional(),
});

async function postComplaint(req: FastifyRequest, reply: FastifyReply) {
  const data = complaintSchema.parse(req.body);
  const branch = await getPublicBranch();
  const phone = normalizePhone(data.phone)!;

  const [client, booking] = await Promise.all([
    prisma.client.findUnique({ where: { branchId_phone: { branchId: branch.id, phone } }, select: { id: true } }),
    data.manageToken ? prisma.booking.findUnique({ where: { manageToken: data.manageToken }, select: { id: true } }) : null,
  ]);

  const complaint = await prisma.complaint.create({
    data: {
      branchId: branch.id,
      name: data.name,
      phone,
      category: data.category,
      message: data.message,
      clientId: client?.id ?? null,
      bookingId: booking?.id ?? null,
    },
  });

  void sendSms(phone, `${branch.name}: we received your message and will get back to you soon. Reference ${complaint.id.slice(-6).toUpperCase()}.`, "complaint_received");
  if (branch.phone) {
    const owner = normalizePhone(branch.phone);
    if (owner) void sendSms(owner, `New complaint from ${data.name} (${phone}). Open the Feedback page to respond.`, "complaint_alert");
  }
  return reply.status(201).send({ reference: complaint.id.slice(-6).toUpperCase() });
}

/* ─── Visitor analytics (cookie-free, no IP, no personal data) ────────── */

const EVENT_TYPES = ["page_view", "service_selected", "slot_selected", "details_view", "booking_submitted", "booking_confirmed"] as const;
const trackSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().max(200).startsWith("/"),
  sessionId: z.string().regex(/^[\w-]{8,64}$/),
  referrer: z.string().max(300).optional(),
});

const BOT = /bot|crawl|spider|preview|monitor|curl|wget|headless|lighthouse/i;

async function track(req: FastifyRequest, reply: FastifyReply) {
  const parsed = trackSchema.safeParse(req.body);
  const ua = String(req.headers["user-agent"] ?? "");
  // Analytics must never produce errors for visitors, and bots should not skew the numbers.
  if (!parsed.success || BOT.test(ua) || !ua) return reply.status(204).send();

  let referrer: string | null = null;
  if (parsed.data.referrer) {
    try {
      const host = new URL(parsed.data.referrer).hostname.replace(/^www\./, "");
      const own = new URL(env.PUBLIC_BOOKING_BASE_URL).hostname.replace(/^www\./, "");
      if (host !== own) referrer = host;
    } catch {
      /* ignore malformed referrers */
    }
  }

  await prisma.analyticsEvent
    .create({
      data: {
        type: parsed.data.type,
        path: parsed.data.path.split("?")[0]!,
        sessionId: parsed.data.sessionId,
        referrer,
        device: /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop",
      },
    })
    .catch(() => {});
  return reply.status(204).send();
}

export async function sitePublicRoutes(app: FastifyInstance) {
  app.get("/landing", landing);
  app.post("/gallery/:id/like", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, likePhoto);

  app.get("/review/:token", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, getReview);
  app.post("/review/:token/send-code", { config: { rateLimit: { max: 6, timeWindow: "1 hour" } } }, sendReviewCode);
  app.post("/review/:token/verify", { config: { rateLimit: { max: 15, timeWindow: "1 hour" } } }, verifyReviewCode);
  app.post("/review/:token", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, postReview);

  app.post("/complaints", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, postComplaint);

  app.post("/track", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, track);
}

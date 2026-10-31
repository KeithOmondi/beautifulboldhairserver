import { prisma } from "../config/db";
import { sendReminder, sendReviewRequest } from "../features/notification/notify";
import { expireStaleOrders } from "../features/shop/shop.service";

/**
 * Lightweight in-process scheduler (single instance). Each task is idempotent, so running two
 * instances is safe, just redundant. Move to a dedicated worker/queue if you scale out.
 */

async function releaseExpiredHolds() {
  const now = new Date();
  await prisma.slotHold.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  // Housekeeping: finished holds are only useful for a short while (status polling).
  await prisma.slotHold.deleteMany({
    where: { status: { in: ["EXPIRED", "FAILED"] }, expiresAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } },
  });
}

async function sendDueReminders() {
  const now = new Date();
  const due = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      startAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) },
    },
    select: { id: true, createdAt: true, startAt: true },
    take: 50,
  });

  for (const b of due) {
    // Booked inside the last 24h? The confirmation SMS is reminder enough.
    const bookedAhead = b.startAt.getTime() - b.createdAt.getTime() > 24 * 3_600_000;
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
    if (bookedAhead) await sendReminder(b.id).catch((e) => console.error("reminder failed", e));
  }
}

/** Two hours after an appointment is completed, ask the client how it went (once). */
async function requestReviews() {
  const now = Date.now();
  const due = await prisma.booking.findMany({
    where: {
      status: "COMPLETED",
      reviewRequestedAt: null,
      feedback: null,
      endAt: { lt: new Date(now - 2 * 3_600_000), gt: new Date(now - 3 * 86_400_000) },
    },
    select: { id: true },
    take: 30,
  });
  for (const b of due) {
    await prisma.booking.update({ where: { id: b.id }, data: { reviewRequestedAt: new Date() } });
    await sendReviewRequest(b.id).catch((e) => console.error("review request failed", e));
  }
}

async function cleanupOtps() {
  await prisma.otpCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
}

function every(ms: number, name: string, task: () => Promise<void>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      console.error(`[job:${name}] failed`, err);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

export function startScheduler() {
  const timers = [
    every(60_000, "release-holds", releaseExpiredHolds),
    every(5 * 60_000, "reminders", sendDueReminders),
    every(10 * 60_000, "review-requests", requestReviews),
    every(2 * 60_000, "expire-shop-orders", async () => { await expireStaleOrders(); }),
    every(6 * 3_600_000, "otp-cleanup", cleanupOtps),
  ];
  return () => timers.forEach(clearInterval);
}

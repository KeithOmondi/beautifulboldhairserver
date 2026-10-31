import { prisma } from "../../config/db";
import { env } from "../../config/env";
import { sendSms } from "../../integrations/sms";
import { formatDateTime } from "../../utils/time";

/**
 * Customer-facing messages. They never throw: a failed SMS must not fail a booking.
 */

async function businessName(branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
  return branch?.name ?? "the salon";
}

export const manageLink = (token: string) => `${env.PUBLIC_BOOKING_BASE_URL.replace(/\/$/, "")}/manage/${token}`;

export async function notifyBookingConfirmed(bookingId: string) {
  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, service: true, staff: { select: { name: true } } },
    });
    if (!b) return;
    const name = await businessName(b.branchId);
    const deposit = b.depositPaid > 0 ? ` Deposit KES ${b.depositPaid.toLocaleString()} received.` : "";
    await sendSms(
      b.client.phone,
      `${name}: Hi ${b.client.name.split(" ")[0]}, your ${b.service.name} with ${b.staff.name} is booked for ${formatDateTime(b.startAt)}.${deposit} Manage: ${manageLink(b.manageToken)}`,
      "booking_confirmed",
    );
  } catch (err) {
    console.error("notifyBookingConfirmed failed", err);
  }
}

export async function notifyBookingCancelled(bookingId: string) {
  try {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, service: true } });
    if (!b) return;
    const name = await businessName(b.branchId);
    const refund = b.depositRefundDue ? " Your deposit will be refunded." : "";
    await sendSms(
      b.client.phone,
      `${name}: your ${b.service.name} on ${formatDateTime(b.startAt)} was cancelled.${refund} Book again anytime: ${env.PUBLIC_BOOKING_BASE_URL}`,
      "booking_cancelled",
    );
  } catch (err) {
    console.error("notifyBookingCancelled failed", err);
  }
}

export async function notifyBookingRescheduled(bookingId: string) {
  try {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, service: true } });
    if (!b) return;
    const name = await businessName(b.branchId);
    await sendSms(
      b.client.phone,
      `${name}: your ${b.service.name} has moved to ${formatDateTime(b.startAt)}. Manage: ${manageLink(b.manageToken)}`,
      "booking_rescheduled",
    );
  } catch (err) {
    console.error("notifyBookingRescheduled failed", err);
  }
}

export async function sendReminder(bookingId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { client: true, service: true, staff: { select: { name: true } } },
  });
  if (!b) return;
  const name = await businessName(b.branchId);
  await sendSms(
    b.client.phone,
    `${name}: reminder - ${b.service.name} with ${b.staff.name} on ${formatDateTime(b.startAt)}. Need to change it? ${manageLink(b.manageToken)}`,
    "booking_reminder",
  );
}

export async function sendReviewRequest(bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true } });
  if (!b) return;
  const name = await businessName(b.branchId);
  const base = env.PUBLIC_BOOKING_BASE_URL.replace(/\/$/, "");
  await sendSms(
    b.client.phone,
    `${name}: thank you for visiting, ${b.client.name.split(" ")[0]}! How was it? Leave a review here: ${base}/review/${b.manageToken} (we will text a code to this number to confirm it is you)`,
    "review_request",
  );
}

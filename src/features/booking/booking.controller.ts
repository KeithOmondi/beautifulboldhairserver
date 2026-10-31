import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import * as bookingService from "./booking.service";
import { getPaymentRequest, requestBalancePayment } from "./payment-request.service";
import {
  cancelBookingSchema,
  checkoutSchema,
  createBookingSchema,
  listBookingsSchema,
  rescheduleBookingSchema,
  updateStatusSchema,
} from "./booking.schema";

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

/** GET /api/v1/bookings?date=YYYY-MM-DD | from=&to= [&staffId&status&clientId] */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = listBookingsSchema.parse(req.query);
  // Stylists only ever see their own appointments.
  const staffId = req.user.role === "WORKER" ? req.user.sub : query.staffId;
  return reply.send(await bookingService.listBookings(req.user.branchId, { ...query, staffId }));
}

export async function get(req: FastifyRequest, reply: FastifyReply) {
  const booking = await bookingService.getBooking(req.user.branchId, idOf(req));
  if (req.user.role === "WORKER" && booking.staff.id !== req.user.sub) {
    return reply.status(403).send({ error: "FORBIDDEN", message: "You can only view your own appointments." });
  }
  return reply.send(booking);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createBookingSchema.parse(req.body);
  return reply.status(201).send(await bookingService.createBooking(req.user.branchId, data, req.user.sub));
}

export async function setStatus(req: FastifyRequest, reply: FastifyReply) {
  const { status } = updateStatusSchema.parse(req.body);
  return reply.send(await bookingService.setStatus(req.user.branchId, idOf(req), status, req.user.sub));
}

export async function checkout(req: FastifyRequest, reply: FastifyReply) {
  const data = checkoutSchema.parse(req.body);
  return reply.send(await bookingService.checkout(req.user.branchId, idOf(req), data, req.user.sub));
}

const requestPaymentSchema = z.object({
  phone: z.string().trim().max(20).optional(),
  amount: z.number().int().min(1).max(1_000_000).optional(),
});

export async function requestPayment(req: FastifyRequest, reply: FastifyReply) {
  const data = requestPaymentSchema.parse(req.body ?? {});
  return reply.status(201).send(await requestBalancePayment(req.user.branchId, idOf(req), data, req.user.sub));
}

export async function paymentRequestStatus(req: FastifyRequest, reply: FastifyReply) {
  const { requestId } = req.params as { requestId: string };
  return reply.send(await getPaymentRequest(req.user.branchId, requestId));
}

export async function cancel(req: FastifyRequest, reply: FastifyReply) {
  const opts = cancelBookingSchema.parse(req.body ?? {});
  return reply.send(await bookingService.cancelBooking(req.user.branchId, idOf(req), opts, req.user.sub));
}

export async function reschedule(req: FastifyRequest, reply: FastifyReply) {
  const data = rescheduleBookingSchema.parse(req.body);
  return reply.send(await bookingService.rescheduleBooking(req.user.branchId, idOf(req), data));
}

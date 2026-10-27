import type { FastifyReply, FastifyRequest } from "fastify";
import * as bookingService from "./booking.service";
import { createBookingSchema, rescheduleBookingSchema } from "./booking.schema";

/**
 * POST /api/v1/bookings
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = createBookingSchema.parse(req.body);
  const booking = await bookingService.createBooking(req.user.branchId, data);
  return reply.status(201).send(booking);
}

/**
 * GET /api/v1/bookings?date=YYYY-MM-DD
 */
export async function list(req: FastifyRequest, reply: FastifyReply) {
  const { date } = req.query as { date?: string };
  const bookings = await bookingService.listBookings(req.user.branchId, date);
  return reply.send(bookings);
}

/**
 * DELETE /api/v1/bookings/:id
 */
export async function cancel(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const result = await bookingService.cancelBooking(req.user.branchId, id);
  return reply.send(result);
}

/**
 * PATCH /api/v1/bookings/:id/reschedule
 */
export async function reschedule(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const data = rescheduleBookingSchema.parse(req.body);
  const result = await bookingService.rescheduleBooking(req.user.branchId, id, data);
  return reply.send(result);
}
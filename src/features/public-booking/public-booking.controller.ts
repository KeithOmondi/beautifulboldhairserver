import type { FastifyReply, FastifyRequest } from "fastify";
import * as service from "./public-booking.service";
import { createPublicBookingSchema, publicAvailabilitySchema, publicRescheduleSchema } from "./public-booking.schema";

const param = (req: FastifyRequest, key: string) => (req.params as Record<string, string>)[key]!;

export const info = async (_req: FastifyRequest, reply: FastifyReply) => reply.send(await service.getPublicInfo());
export const services = async (_req: FastifyRequest, reply: FastifyReply) => reply.send(await service.getPublicServices());
export const staff = async (req: FastifyRequest, reply: FastifyReply) =>
  reply.send(await service.getPublicStaff((req.query as { serviceId?: string }).serviceId));

export async function availability(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await service.getPublicAvailability(publicAvailabilitySchema.parse(req.query)));
}

export async function createBooking(req: FastifyRequest, reply: FastifyReply) {
  const input = createPublicBookingSchema.parse(req.body);
  return reply.status(201).send(await service.createPublicBooking(input));
}

export async function holdStatus(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await service.getHoldStatus(param(req, "id")));
}

export async function getManaged(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await service.getManagedBooking(param(req, "token")));
}

export async function cancelManaged(req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await service.cancelManagedBooking(param(req, "token")));
}

export async function rescheduleManaged(req: FastifyRequest, reply: FastifyReply) {
  const { newStartAt } = publicRescheduleSchema.parse(req.body);
  return reply.send(await service.rescheduleManagedBooking(param(req, "token"), newStartAt));
}

/** The branches a customer can book at, and the one they are currently looking at. */
export async function branches(_req: FastifyRequest, reply: FastifyReply) {
  const [list, current] = await Promise.all([service.listPublicBranches(), service.getPublicBranch()]);
  reply.header("Cache-Control", "no-store");
  return reply.send({ current: current.slug, branches: list });
}

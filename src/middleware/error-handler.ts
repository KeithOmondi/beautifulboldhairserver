import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";

// Prisma 7 with a driver adapter may nest the Postgres error, so walk the chain.
function findPgError(err: unknown): { code?: string; message?: string } | null {
  let cur: any = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) return cur;
    cur = cur.cause ?? cur.meta;
  }
  return null;
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
  }

  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({ error: err.code ?? "ERROR", message: err.message });
  }

  const pg = findPgError(err);
  const text = `${err.message} ${pg?.message ?? ""}`;

  // Booking_no_overlap exclusion constraint
  if (pg?.code === "23P01" || text.includes("Booking_no_overlap")) {
    return reply.status(409).send({ error: "SLOT_TAKEN", message: "That time slot is no longer available." });
  }
  // Triggers from the custom_constraints migration
  if (text.includes("is locked and cannot be modified")) {
    return reply.status(423).send({ error: "LOCKED", message: "This record is locked and cannot be changed." });
  }
  if (text.includes("AuditLog is append-only")) {
    return reply.status(403).send({ error: "APPEND_ONLY", message: "Audit records cannot be changed." });
  }

  const status = (err as FastifyError).statusCode;
  if (status && status < 500) {
    return reply.status(status).send({ error: "BAD_REQUEST", message: err.message });
  }

  req.log.error(err);
  return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong." });
}
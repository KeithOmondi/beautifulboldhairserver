import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env";
import { ACCEPTED, handleStkCallback, type StkCallbackBody } from "./mpesa-callback.service";

/**
 * POST /api/v1/public/payment-callback?secret=...
 * Safaricom has no request signature, so an unguessable secret in the callback URL is our authentication.
 * Always answers 200 so Safaricom does not retry forever.
 */
export async function mpesaCallback(req: FastifyRequest, reply: FastifyReply) {
  if (env.MPESA_CALLBACK_SECRET) {
    const secret = (req.query as { secret?: string }).secret;
    if (secret !== env.MPESA_CALLBACK_SECRET) {
      req.log.warn({ ip: req.ip }, "M-Pesa callback rejected: bad secret");
      return reply.status(403).send({ ResultCode: 1, ResultDesc: "Forbidden" });
    }
  }

  try {
    return reply.send(await handleStkCallback((req.body ?? {}) as StkCallbackBody));
  } catch (error) {
    req.log.error({ err: error }, "M-Pesa callback processing failed");
    return reply.send(ACCEPTED);
  }
}

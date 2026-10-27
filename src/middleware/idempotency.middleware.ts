import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../config/db";

/**
 * Idempotency Middleware
 * 
 * Prevents duplicate processing of requests (especially payments/callbacks).
 * It requires the client to send an `X-Idempotency-Key` header (or extracts the 
 * M-Pesa receipt number from the body).
 */
export async function idempotency(req: FastifyRequest, reply: FastifyReply) {
  // 1. Look for an idempotency key in the headers, or fall back to the M-Pesa receipt
  const headerKey = req.headers["x-idempotency-key"] as string;
  const bodyKey = (req.body as any)?.mpesaReceipt || (req.body as any)?.Body?.stkCallback?.CheckoutRequestID;
  
  const key = headerKey || bodyKey;

  // If no key is provided, we let the request pass (or you can throw an error if you want it strict)
  if (!key) {
    return; 
  }

  // 2. Check if this key has already been processed.
  // For M-Pesa, we check the Payment table for that unique receipt.
  if (bodyKey) {
    const existingPayment = await prisma.payment.findUnique({
      where: { mpesaReceipt: bodyKey },
      select: { id: true }
    });

    if (existingPayment) {
      // If it exists, we stop the request and return a 200 OK.
      // We return 200 so Safaricom knows we received it and stops retrying.
      req.log.warn(`[Idempotency] Duplicate M-Pesa callback ignored for receipt: ${bodyKey}`);
      return reply.status(200).send({
        error: "DUPLICATE_REQUEST",
        message: "This transaction has already been processed.",
        paymentId: existingPayment.id
      });
    }
  }
}
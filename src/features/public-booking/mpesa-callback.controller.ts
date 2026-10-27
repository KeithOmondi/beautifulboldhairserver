import type { FastifyReply, FastifyRequest } from "fastify";
import { handleMpesaCallback } from "./mpesa-callback.service";
import { prisma } from "../../config/db";

export async function mpesaCallback(req: FastifyRequest, reply: FastifyReply) {
  // Safaricom posts a nested JSON body
  const payload = req.body as any;

  // Safaricom doesn't send a branch ID, so we use the first active branch (single-branch setup)
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  
  if (!branch) {
    return reply.send({ ResultCode: 0, ResultDesc: "No Branch" });
  }

  try {
    const result = await handleMpesaCallback(branch.id, payload);
    return reply.send(result);
  } catch (error) {
    // Safely handle the unknown error type
    const errorMessage = error instanceof Error ? error.message : String(error);
    req.log.error({ err: errorMessage }, "M-Pesa Callback Error");
    
    // Always return 200 OK to Safaricom
    return reply.send({ ResultCode: 0, ResultDesc: "Accepted" });
  }
}
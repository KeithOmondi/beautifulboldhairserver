import type { FastifyInstance } from "fastify";
import { prisma } from "../config/db";

export async function healthRoutes(app: FastifyInstance) {
  // Liveness: the process is up.
  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  // Readiness: the process can reach the database.
  app.get("/health/db", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "up" };
    } catch {
      return reply.status(503).send({ status: "error", db: "down" });
    }
  });
}
///src/features/staff/index.ts


import type { FastifyInstance } from "fastify";
import { authRoutes } from "../auth/auth.routes";
import { staffRoutes } from "./staff.routes";

export async function registerFeatures(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(staffRoutes, { prefix: "/api/v1/staff" });
}
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { strictLoginLimit } from "../../middleware/rate-limit";
import * as controller from "./auth.controller";

export async function authRoutes(app: FastifyInstance) {
  // Public routes (rate limited to prevent brute force)
  app.post("/login", { config: strictLoginLimit }, controller.login);
  app.post("/request-password-reset", { config: strictLoginLimit }, controller.requestPasswordReset);
  app.post("/reset-password", { config: strictLoginLimit }, controller.resetPassword);

  // Protected routes (require a valid JWT)
  app.get("/me", { preHandler: authenticate }, controller.me);
  app.patch("/change-password", { preHandler: authenticate }, controller.changePassword);
}
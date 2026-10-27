import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { healthRoutes } from "./routes/health.routes";
import { registerFeatures } from "./features/auth";

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: env.NODE_ENV === "production" ? "info" : "debug" },
  });

  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? [env.PUBLIC_BOOKING_BASE_URL] : true,
  });
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.setErrorHandler(errorHandler);

  // Global routes (no prefix, no auth)
  await app.register(healthRoutes);

  // All feature routes, registered in src/features/index.ts
  await registerFeatures(app);

  return app;
}
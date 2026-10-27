import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Registers the global rate limiting plugin.
 * By default, this allows 100 requests per minute per IP address.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 100, // Default: max 100 requests
    timeWindow: "1 minute",
    errorResponseBuilder: (req, context) => {
      return {
        error: "RATE_LIMITED",
        message: `Too many requests. Please try again in ${context.after}.`,
      };
    },
  });
}

/**
 * Strict rate limit specifically for login attempts.
 * Allows 5 attempts per minute per IP.
 */
export const strictLoginLimit = {
  rateLimit: {
    max: 5,
    timeWindow: "1 minute",
  },
};

/**
 * Strict rate limit for OTP (SMS) sending.
 * Allows 3 requests per 5 minutes per IP (prevents SMS bombing).
 */
export const strictOtpLimit = {
  rateLimit: {
    max: 3,
    timeWindow: "5 minutes",
  },
};
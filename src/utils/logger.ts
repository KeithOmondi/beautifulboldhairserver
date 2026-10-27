import pino from "pino";
import { env } from "../config/env";

const isDevelopment = env.NODE_ENV === "development";

// Build the options object conditionally to satisfy exactOptionalPropertyTypes
const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL || "info",
};

if (isDevelopment) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

export const logger = pino(options);

/**
 * Creates a child logger with contextual bindings (like a request ID or user ID).
 * Useful for tracing a specific request through the whole app.
 */
export function createContextLogger(context: Record<string, any>) {
  return logger.child(context);
}
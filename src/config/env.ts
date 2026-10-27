import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  TZ: z.string().default("Africa/Nairobi"),

  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // ─── Brevo Email Configuration ───
  BREVO_API_KEY: z.string().min(1, "Brevo API key is required"),
  BREVO_SENDER_EMAIL: z.string().email("Brevo sender email must be valid"),
  BREVO_SENDER_NAME: z.string().min(1, "Brevo sender name is required"),

  SLOT_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  PUBLIC_BOOKING_BASE_URL: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Add to your schema object:
MPESA_CONSUMER_KEY: z.string().min(1),
MPESA_CONSUMER_SECRET: z.string().min(1),
MPESA_SHORTCODE: z.string().min(1),
MPESA_PASSKEY: z.string().min(1),
MPESA_CALLBACK_URL: z.string().url(),
MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
process.env.TZ = env.TZ;
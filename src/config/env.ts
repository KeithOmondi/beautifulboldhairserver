import "dotenv/config";
import { z } from "zod";

const optional = z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  TZ: z.string().default("Africa/Nairobi"),

  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // Where the public booking site lives (used in SMS links and CORS).
  PUBLIC_BOOKING_BASE_URL: z.string().default("http://localhost:5173"),
  // Extra allowed browser origins, comma separated (only needed if the client is hosted separately).
  CORS_ORIGINS: optional,
  // Serve the built client (../client/dist) from this process. Simplest production setup: one URL, no CORS.
  SERVE_CLIENT: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  CLIENT_DIST: z.string().default("../client/dist"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SLOT_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),

  // ─── Email (Brevo) - optional; password reset needs it ───
  BREVO_API_KEY: optional,
  BREVO_SENDER_EMAIL: optional,
  BREVO_SENDER_NAME: optional,

  // ─── SMS - optional; without it messages are only logged. TalkSasa is used when its token is set, else Africa's Talking. ───
  TALKSASA_API_TOKEN: optional,
  TALKSASA_SENDER_ID: optional,
  TALKSASA_BASE_URL: optional,
  SMS_PROVIDER_API_KEY: optional,
  SMS_USERNAME: optional,
  SMS_SENDER_ID: optional,

  // ─── Cloudinary (gallery image hosting) - optional ───
  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,

  // ─── M-Pesa Daraja - optional; without it deposits are disabled ───
  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: optional,
  MPESA_CONSUMER_SECRET: optional,
  MPESA_SHORTCODE: optional,
  MPESA_PASSKEY: optional,
  // CustomerPayBillOnline for a Paybill; CustomerBuyGoodsOnline for a Till number.
  MPESA_TRANSACTION_TYPE: z.enum(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"]).default("CustomerPayBillOnline"),
  MPESA_CALLBACK_URL: optional,
  // Appended by you to MPESA_CALLBACK_URL as ?secret=... ; callbacks without it are rejected.
  MPESA_CALLBACK_SECRET: optional,
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

if (env.NODE_ENV === "production") {
  const weak = /dev-only|change-me|secret|password/i.test(env.JWT_SECRET);
  if (weak) {
    console.error("❌ JWT_SECRET looks like a placeholder. Generate one with: openssl rand -hex 48");
    process.exit(1);
  }
}

export const mpesaEnabled = Boolean(
  env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORTCODE && env.MPESA_PASSKEY && env.MPESA_CALLBACK_URL,
);
export const cloudinaryEnabled = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
export const emailEnabled = Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL);
export const talksasaEnabled = Boolean(env.TALKSASA_API_TOKEN && env.TALKSASA_SENDER_ID);
export const smsEnabled = talksasaEnabled || Boolean(env.SMS_PROVIDER_API_KEY && env.SMS_USERNAME);

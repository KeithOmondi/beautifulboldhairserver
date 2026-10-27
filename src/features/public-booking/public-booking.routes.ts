import type { FastifyInstance } from "fastify";
import * as controller from "./public-booking.controller";
import { mpesaCallback } from "./mpesa-callback.controller"; // <-- Add this
import { strictOtpLimit } from "../../middleware/rate-limit";
import { authenticateClient } from "../../middleware/public-auth.middleware";

export async function publicBookingRoutes(app: FastifyInstance) {
  // 1. Unauthenticated routes (require strict rate limiting to prevent abuse)
  app.post(
    "/request-otp", 
    { config: strictOtpLimit }, 
    controller.requestOtp
  );
  
  app.post(
    "/verify-otp", 
    { config: strictOtpLimit }, 
    controller.verifyOtp
  );

  // 2. Client-authenticated routes (require the 15-minute JWT from verify-otp)
  app.post(
    "/hold-slot", 
    { preHandler: [authenticateClient] }, 
    controller.holdSlot
  );

  app.post(
    "/confirm", 
    { preHandler: [authenticateClient] }, 
    controller.confirmBooking
  );

  // 3. M-Pesa Callback (public webhook called by Safaricom)
  app.post("/mpesa-callback", mpesaCallback);
}
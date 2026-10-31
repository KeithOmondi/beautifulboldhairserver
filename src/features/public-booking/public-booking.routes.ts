import type { FastifyInstance } from "fastify";
import * as controller from "./public-booking.controller";
import { mpesaCallback } from "./mpesa-callback.controller";

const bookingLimit = { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } };
const manageLimit = { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } };

/** Everything the customer-facing booking site needs. No login: the booking link itself is the credential. */
export async function publicBookingRoutes(app: FastifyInstance) {
  app.get("/info", controller.info);
  app.get("/branches", controller.branches);
  app.get("/services", controller.services);
  app.get("/staff", controller.staff);
  app.get("/availability", controller.availability);

  app.post("/bookings", bookingLimit, controller.createBooking);
  app.get("/holds/:id", controller.holdStatus);

  app.get("/manage/:token", manageLimit, controller.getManaged);
  app.post("/manage/:token/cancel", manageLimit, controller.cancelManaged);
  app.post("/manage/:token/reschedule", manageLimit, controller.rescheduleManaged);

  // Webhook called by Safaricom.
  app.post("/payment-callback", mpesaCallback);
}

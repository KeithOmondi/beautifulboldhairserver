import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./booking.controller";

export async function bookingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  const frontDesk = { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST")] };

  // Everyone can view the calendar (stylists are limited to their own appointments in the controller).
  app.get("/", controller.list);
  app.get("/:id", controller.get);

  app.post("/", frontDesk, controller.create);
  app.patch("/:id/status", frontDesk, controller.setStatus);
  app.post("/:id/checkout", frontDesk, controller.checkout);
  app.post("/:id/request-payment", { ...frontDesk, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, controller.requestPayment);
  app.get("/payment-requests/:requestId", frontDesk, controller.paymentRequestStatus);
  app.patch("/:id/reschedule", frontDesk, controller.reschedule);
  app.post("/:id/cancel", frontDesk, controller.cancel);
}

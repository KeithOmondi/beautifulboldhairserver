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
  // Anyone limited to one side of the business (lashes or hair & wigs) can only open and act on that side's bookings.
  const mine = controller.inMyDepartment;
  app.get("/:id", { preHandler: [mine] }, controller.get);

  app.post("/", frontDesk, controller.create);
  app.patch("/:id/status", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST"), mine] }, controller.setStatus);
  app.post("/:id/checkout", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST"), mine] }, controller.checkout);
  app.post("/:id/request-payment", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST"), mine], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, controller.requestPayment);
  app.get("/payment-requests/:requestId", frontDesk, controller.paymentRequestStatus);
  app.patch("/:id/reschedule", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST"), mine] }, controller.reschedule);
  app.post("/:id/cancel", { preHandler: [authorize("OWNER", "MANAGER", "RECEPTIONIST"), mine] }, controller.cancel);
}

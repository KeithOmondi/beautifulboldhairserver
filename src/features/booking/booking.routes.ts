import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./booking.controller";
import { Role } from "../../generated/prisma/client";

export async function bookingRoutes(app: FastifyInstance) {
  // All booking routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only front-desk staff and managers can create/modify bookings
  const canManage = { 
    preHandler: [authorize(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST)] 
  };

  // Everyone can view the calendar
  app.get("/", controller.list);

  // Manage bookings
  app.post("/", canManage, controller.create);
  app.patch("/:id/reschedule", canManage, controller.reschedule);
  app.delete("/:id", canManage, controller.cancel);
}
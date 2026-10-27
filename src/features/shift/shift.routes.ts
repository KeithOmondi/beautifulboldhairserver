import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./shift.controller";
import { Role } from "../../generated/prisma/client";

export async function shiftRoutes(app: FastifyInstance) {
  // All shift routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only OWNER and MANAGER can modify shifts
  const canManage = { preHandler: [authorize(Role.OWNER, Role.MANAGER)] };

  // List shifts for a specific staff member
  app.get("/:staffId", controller.list);

  // Create a single shift
  app.post("/", canManage, controller.create);

  // Create recurring shifts (bulk)
  app.post("/recurring", canManage, controller.createRecurring);

  // Add a break to a specific shift
  app.post("/:shiftId/breaks", canManage, controller.addBreak);

  // Update a shift
  app.patch("/:shiftId", canManage, controller.update);

  // Delete a shift
  app.delete("/:shiftId", canManage, controller.remove);
}
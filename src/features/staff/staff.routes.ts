import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import * as controller from "./staff.controller";
import { Role } from "../../generated/prisma/client";

export async function staffRoutes(app: FastifyInstance) {
  // All routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Only OWNER and MANAGER can manage staff
  const canManage = { preHandler: [authorize(Role.OWNER, Role.MANAGER)] };

  app.get("/", controller.list);
  app.post("/", canManage, controller.create);
  app.patch("/:id", canManage, controller.update);
  app.delete("/:id", canManage, controller.remove);
}
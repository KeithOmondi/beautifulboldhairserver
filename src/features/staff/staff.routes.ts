import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { authorize } from "../../middleware/role.middleware";
import { branchScope } from "../../middleware/branch-scope";
import * as controller from "./staff.controller";

export async function staffRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  const canManage = { preHandler: [authorize("OWNER", "MANAGER")] };

  // The calendar needs the stylist list, so everyone signed in can read it.
  app.get("/", controller.list);
  app.post("/", canManage, controller.create);
  app.patch("/:id", canManage, controller.update);
  app.post("/:id/reset-password", canManage, controller.resetPassword);
  app.delete("/:id", canManage, controller.remove);
}

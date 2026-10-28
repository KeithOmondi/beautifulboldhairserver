import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./payment.controller";
import * as c2bController from "./c2b-callback.controller"; // <-- Add this
import { Role } from "../../generated/prisma/client";

export async function paymentRoutes(app: FastifyInstance) {
  // ─── 1. PUBLIC C2B CALLBACK (No Auth) ───
  // Safaricom hits this directly. It cannot send a JWT.
  app.post("/c2b-callback", c2bController.c2bCallback);

  // ─── 2. AUTHENTICATED ROUTES ───
  // We wrap the rest of the routes in a registered plugin to apply the auth hooks
  // only to these specific routes, not the callback above.
  app.register(async (authApp) => {
    authApp.addHook("preHandler", authenticate);
    authApp.addHook("preHandler", branchScope);

    const canManage = { 
      preHandler: [authorize(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST)] 
    };

    // Payment CRUD
    authApp.get("/", canManage, controller.list);
    authApp.post("/", canManage, controller.create);
    authApp.post("/:id/refund", canManage, controller.refund);

    // C2B Pending Payments Management
    authApp.get("/pending", canManage, c2bController.listPending);
    authApp.post("/pending/assign", canManage, c2bController.assign);
  });
}
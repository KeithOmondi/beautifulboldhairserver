import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./payment.controller";
import * as c2bController from "./c2b-callback.controller"; // <-- Add this
import { Role } from "../../generated/prisma/client";
import { requires } from "../../utils/access";

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
    // Refunds put money back on the books, so they are for the owner (or a manager the owner trusts with it), never the front desk.
    authApp.post("/:id/refund", { preHandler: [authorize(Role.OWNER, Role.MANAGER), requires("refunds")] }, controller.refund);

    // C2B Pending Payments Management
    authApp.get("/pending", canManage, c2bController.listPending);
    authApp.post("/pending/assign", canManage, c2bController.assign);
    // Dismissing an unmatched payment makes it disappear from view, so it needs the same trust as a refund.
    authApp.post("/pending/:id/dismiss", { preHandler: [authorize(Role.OWNER, Role.MANAGER), requires("refunds")] }, c2bController.dismiss);
  });
}
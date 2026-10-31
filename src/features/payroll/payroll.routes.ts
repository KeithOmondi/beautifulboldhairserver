import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.middleware";
import { branchScope } from "../../middleware/branch-scope";
import { authorize } from "../../middleware/role.middleware";
import * as controller from "./payroll.controller";
import { Role } from "../../generated/prisma/client";

export async function payrollRoutes(app: FastifyInstance) {
  // All payroll routes require authentication and branch scoping
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", branchScope);

  // Payroll shows everyone's pay, so only the owner sees it.
  const canView = { 
    preHandler: [authorize(Role.OWNER)] 
  };
  
  // Only OWNER can generate, adjust, or approve payroll
  const canManage = { 
    preHandler: [authorize(Role.OWNER)] 
  };

  // List runs
  app.get("/runs", canView, controller.list);

  // Generate a new month
  app.post("/runs", canManage, controller.generate);

  // Add an adjustment (Advance, Deduction, Bonus)
  app.post("/runs/:runId/adjustments", canManage, controller.addAdjustment);

  // Approve and lock the run
  app.post("/runs/:runId/approve", canManage, controller.approve);
}
import { prisma } from "../config/db";
import type { FastifyRequest } from "fastify";
import type { AuditAction } from "../generated/prisma/client";

interface AuditParams {
  req?: FastifyRequest;
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: any;
  after?: any;
  branchId?: string;
}

export async function recordAudit({
  req,
  action,
  entity,
  entityId,
  before,
  after,
  branchId,
}: AuditParams) {
  try {
    const actorId = req?.user?.sub;
    const resolvedBranchId = branchId || req?.user?.branchId;
    const ipAddress = req?.ip;

    // Fix for exactOptionalPropertyTypes: true
    // We only include optional fields in the object if they are defined.
    const data: any = {
      action,
      entity,
      entityId,
    };

    if (before) data.before = JSON.parse(JSON.stringify(before));
    if (after) data.after = JSON.parse(JSON.stringify(after));
    if (actorId) data.actorId = actorId;
    if (resolvedBranchId) data.branchId = resolvedBranchId;
    if (ipAddress) data.ipAddress = ipAddress;

    await prisma.auditLog.create({ data });
  } catch (error) {
    console.error("❌ Failed to write audit log:", error);
  }
}
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import type { 
  CreateServiceDto, 
  UpdateServiceDto, 
  CreateCommissionOverrideDto 
} from "./service.schema";

/**
 * Lists all active services for a branch.
 */
export async function listServices(branchId: string, includeInactive = false) {
  return prisma.service.findMany({
    where: { 
      branchId,
      ...(includeInactive ? {} : { isActive: true })
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Creates a new service.
 */
export async function createService(branchId: string, data: CreateServiceDto) {
  // Check for duplicate service name in the same branch
  const exists = await prisma.service.findFirst({
    where: { branchId, name: data.name },
  });

  if (exists) {
    throw new AppError(409, "A service with this name already exists", "DUPLICATE_SERVICE");
  }

  return prisma.service.create({
    data: {
      branchId,
      name: data.name,
      durationMin: data.durationMin,
      price: data.price,
      requiresPatchTest: data.requiresPatchTest,
      isWigService: data.isWigService,
      isActive: data.isActive,
    },
  });
}

/**
 * Updates an existing service.
 */
export async function updateService(branchId: string, serviceId: string, data: UpdateServiceDto) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
  });

  if (!service) {
    throw new AppError(404, "Service not found", "NOT_FOUND");
  }

  // If name is changing, ensure no duplicate name exists
  if (data.name && data.name !== service.name) {
    const exists = await prisma.service.findFirst({
      where: { branchId, name: data.name, id: { not: serviceId } },
    });
    if (exists) {
      throw new AppError(409, "A service with this name already exists", "DUPLICATE_SERVICE");
    }
  }

  // FIX: exactOptionalPropertyTypes
  // Build a clean object with only the properties that exist
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.durationMin !== undefined) updateData.durationMin = data.durationMin;
  if (data.price !== undefined) updateData.price = data.price;
  if (data.requiresPatchTest !== undefined) updateData.requiresPatchTest = data.requiresPatchTest;
  if (data.isWigService !== undefined) updateData.isWigService = data.isWigService;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  return prisma.service.update({
    where: { id: serviceId },
    data: updateData,
  });
}

/**
 * Soft-deletes a service by setting isActive = false.
 * We do NOT hard delete because past bookings reference this service.
 */
export async function deactivateService(branchId: string, serviceId: string) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, branchId },
  });

  if (!service) {
    throw new AppError(404, "Service not found", "NOT_FOUND");
  }

  await prisma.service.update({
    where: { id: serviceId },
    data: { isActive: false },
  });

  return { message: "Service deactivated successfully" };
}

/**
 * Creates or updates a custom commission rate for a staff member on a specific service.
 * e.g., "Dennis gets 20% for Wig Installs instead of his default 15%."
 */
export async function setCommissionOverride(
  branchId: string, 
  data: CreateCommissionOverrideDto
) {
  // Verify staff and service belong to this branch
  const staff = await prisma.staff.findFirst({ where: { id: data.staffId, branchId } });
  if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");

  const service = await prisma.service.findFirst({ where: { id: data.serviceId, branchId } });
  if (!service) throw new AppError(404, "Service not found", "NOT_FOUND");

  // Upsert the override (create if new, update if exists)
  return prisma.serviceCommissionOverride.upsert({
    where: {
      staffId_serviceId: {
        staffId: data.staffId,
        serviceId: data.serviceId,
      },
    },
    update: { pct: data.pct },
    create: {
      staffId: data.staffId,
      serviceId: data.serviceId,
      pct: data.pct,
    },
  });
}

/**
 * Removes a commission override (reverts to the staff member's default rate).
 */
export async function removeCommissionOverride(branchId: string, staffId: string, serviceId: string) {
  const override = await prisma.serviceCommissionOverride.findUnique({
    where: { staffId_serviceId: { staffId, serviceId } },
  });

  if (!override) {
    throw new AppError(404, "Commission override not found", "NOT_FOUND");
  }

  await prisma.serviceCommissionOverride.delete({
    where: { staffId_serviceId: { staffId, serviceId } },
  });

  return { message: "Commission override removed" };
}
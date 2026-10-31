import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { normalizePhone } from "../../utils/phone";
import type { CreateClientDto, UpdateClientDto } from "./client.schema";

/**
 * Lists all clients for a branch.
 * Supports an optional search query (matches name or phone).
 */
export async function listClients(branchId: string, searchQuery?: string) {
  const whereClause: any = { branchId };

  if (searchQuery) {
    whereClause.OR = [
      { name: { contains: searchQuery, mode: "insensitive" } },
      { phone: { contains: searchQuery } },
    ];
  }

  const clients = await prisma.client.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // Visit stats in one grouped query rather than per-client lookups.
  const stats = await prisma.booking.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clients.map((c) => c.id) }, status: "COMPLETED" },
    _count: { _all: true },
    _max: { startAt: true },
    _sum: { price: true, discount: true },
  });
  const byClient = new Map(stats.map((s) => [s.clientId, s]));

  return clients.map((c) => {
    const s = byClient.get(c.id);
    return {
      ...c,
      visits: s?._count._all ?? 0,
      lastVisit: s?._max.startAt ?? null,
      totalSpent: (s?._sum.price ?? 0) - (s?._sum.discount ?? 0),
    };
  });
}

/**
 * Gets a single client with their recent booking history.
 */
export async function getClientById(branchId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, branchId },
    include: {
      bookings: {
        take: 10, // Only show the 10 most recent
        orderBy: { startAt: "desc" },
        include: {
          staff: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
    },
  });

  if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
  return client;
}

/**
 * Creates a new client.
 */
export async function createClient(branchId: string, data: CreateClientDto) {
  // 1. Normalize the phone number (e.g., 0712... -> +254712...)
  const phone = normalizePhone(data.phone);
  if (!phone) {
    throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");
  }

  // 2. Prevent duplicate clients
  const existing = await prisma.client.findFirst({
    where: { OR: [{ phone }, { phone: data.phone }] },
  });

  if (existing) {
    throw new AppError(409, "A client with this phone number already exists", "DUPLICATE_CLIENT");
  }

  // 3. Create the client
  return prisma.client.create({
    data: {
      branchId,
      name: data.name,
      phone,
      allergies: data.allergies ?? null,
      isFirstLash: data.isFirstLash,
    },
  });
}

/**
 * Updates an existing client.
 */
export async function updateClient(branchId: string, clientId: string, data: UpdateClientDto) {
  // 1. Verify client exists in this branch
  const client = await prisma.client.findFirst({
    where: { id: clientId, branchId },
  });
  if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

  // 2. Build the update object (handling exactOptionalPropertyTypes)
  const updateData: any = {};
  
  if (data.name !== undefined) updateData.name = data.name;
  if (data.allergies !== undefined) updateData.allergies = data.allergies;
  if (data.isFirstLash !== undefined) updateData.isFirstLash = data.isFirstLash;
  if (data.isBlocked !== undefined) updateData.isBlocked = data.isBlocked;

  // 3. Handle phone change safely
  if (data.phone !== undefined) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new AppError(400, "Invalid Kenyan phone number", "INVALID_PHONE");

    // Check if the new phone number is already taken by another client
    const existing = await prisma.client.findFirst({
      where: { branchId, phone, id: { not: clientId } },
    });

    if (existing) {
      throw new AppError(409, "Another client already has this phone number", "DUPLICATE_CLIENT");
    }
    updateData.phone = phone;
  }

  // 4. Perform the update
  return prisma.client.update({
    where: { id: clientId },
    data: updateData,
  });
}
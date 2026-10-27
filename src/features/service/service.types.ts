import type { Service } from "../../generated/prisma/client";

/**
 * Input for creating a new service.
 */
export interface CreateServiceInput {
  name: string;
  durationMin: number;
  price: number; // Stored as integer shillings
  requiresPatchTest?: boolean; // e.g., for lash extensions
  isWigService?: boolean; // e.g., changes the booking time block
  isActive?: boolean;
}

/**
 * Input for updating an existing service.
 */
export interface UpdateServiceInput {
  name?: string;
  durationMin?: number;
  price?: number;
  requiresPatchTest?: boolean;
  isWigService?: boolean;
  isActive?: boolean;
}

/**
 * Input for setting a custom commission override.
 * (e.g., Worker A gets 20% for wigs, but the default is 10%)
 */
export interface CreateCommissionOverrideInput {
  staffId: string;
  serviceId: string;
  pct: number; // Basis points (e.g., 1500 = 15.00%)
}

/**
 * The full Service object, plus its overrides if needed.
 */
export type ServiceWithOverrides = Service & {
  overrides?: {
    staffId: string;
    pct: number;
  }[];
};
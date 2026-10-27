import type { Client, Booking, ConsentRecord } from "../../generated/prisma/client";

/**
 * Input for creating a new client.
 */
export interface CreateClientInput {
  name: string;
  phone: string; // We accept any format here; the service normalizes it.
  allergies?: string;
  isFirstLash?: boolean;
}

/**
 * Input for updating an existing client.
 */
export interface UpdateClientInput {
  name?: string;
  phone?: string;
  allergies?: string | null;
  isFirstLash?: boolean;
  isBlocked?: boolean;
}

/**
 * A client with their recent booking history.
 * Useful for the receptionist when viewing a client profile.
 */
export type ClientWithHistory = Client & {
  bookings: (Booking & {
    staff: { name: string };
    service: { name: string };
  })[];
};

/**
 * A client with all their sensitive data (for GDPR/DPA compliance exports).
 */
export type ClientFullProfile = Client & {
  bookings: Booking[];
  consents: ConsentRecord[];
};
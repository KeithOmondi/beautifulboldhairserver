import type { 
  BookingSource, 
  BookingStatus, 
  Booking 
} from "../../generated/prisma/client";

/**
 * The input required to create a new booking.
 */
export interface CreateBookingInput {
  clientId: string;
  staffId: string;
  serviceId: string;
  startAt: string; // ISO 8601 string (e.g., "2026-11-02T09:00:00+03:00")
  source?: BookingSource;
  notes?: string;
}

/**
 * The detailed response returned after a booking is successfully created.
 */
export interface CreateBookingResponse {
  bookingId: string;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  staffName: string;
  serviceName: string;
  clientName: string;
  price: number;
  manageToken: string; // Used by the client to reschedule/cancel later
}

/**
 * The response for listing bookings (includes related client, staff, and service data).
 */
export type BookingWithRelations = Booking & {
  client: {
    id: string;
    name: string;
    phone: string;
  };
  staff: {
    id: string;
    name: string;
  };
  service: {
    id: string;
    name: string;
    durationMin: number;
  };
};

/**
 * Input for rescheduling an existing booking.
 */
export interface RescheduleBookingInput {
  newStartAt: string; // ISO 8601 string
  staffId?: string;   // Optional: in case they want a different worker
}
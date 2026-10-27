/**
 * The query parameters passed to the Availability Engine.
 */
export interface GetAvailabilityInput {
  staffId: string;
  date: string; // Format: "YYYY-MM-DD" (e.g., "2026-10-28")
  serviceId: string;
}

/**
 * A single available time slot.
 */
export interface TimeSlot {
  startTime: string; // Format: "HH:mm" (e.g., "09:00")
  endTime: string;   // Format: "HH:mm" (e.g., "10:00")
}

/**
 * The response from the Availability Engine.
 */
export interface AvailabilityResponse {
  staffId: string;
  date: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  isWorking: boolean; // If false, the staff member has no shift on this day
  availableSlots: TimeSlot[];
}

/**
 * Internal representation of a busy time block (booking, break, time-off).
 * Stored as minutes from midnight for easy math.
 */
export interface BusyBlock {
  start: number;
  end: number;
  reason: "BOOKING" | "BREAK" | "TIME_OFF";
}
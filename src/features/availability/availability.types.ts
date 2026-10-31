/** A single available time slot. */
export interface TimeSlot {
  startTime: string; // "HH:mm" (Nairobi)
  endTime: string; // "HH:mm" (Nairobi)
  startAt: string; // ISO instant, send this back when booking
}

export interface AvailabilityResponse {
  staffId: string;
  date: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  isWorking: boolean; // false when the staff member has no hours on this day
  availableSlots: TimeSlot[];
}

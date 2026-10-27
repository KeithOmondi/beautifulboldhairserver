export interface DashboardSummary {
  today: {
    revenue: number;
    bookingCount: number;
    completedCount: number;
    pendingCount: number;
    cancelledCount: number;
  };
  month: {
    revenue: number;
    bookingCount: number;
    commissionOwed: number;
  };
  staffOnDuty: {
    id: string;
    name: string;
    role: string;
    shiftEndsAt: Date;
  }[];
  topServices: {
    name: string;
    count: number;
    revenue: number;
  }[];
  pendingCashUps: number;
  lastCashUp: {
    date: Date | null;
    difference: number;
  };
}
import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.routes";
import { staffRoutes } from "../staff/staff.routes";
import { shiftRoutes } from "../shift/shift.routes";
import { serviceRoutes } from "../service/service.routes";
import { availabilityRoutes } from "../availability/availability.routes";
import { bookingRoutes } from "../booking/booking.routes";
import { clientRoutes } from "../client/client.routes";
import { paymentRoutes } from "../payment/payment.routes";
import { cashUpRoutes } from "../cash-up/cash-up.routes";
import { payrollRoutes } from "../payroll/payroll.routes";
import { dashboardRoutes } from "../dashboard/dashboard.routes";
import { publicBookingRoutes } from "../public-booking/public-booking.routes";

// One line per feature, added as each feature is written.
export async function registerFeatures(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(staffRoutes, { prefix: "/api/v1/staff" });
  await app.register(shiftRoutes, { prefix: "/api/v1/shifts" });
  await app.register(serviceRoutes, { prefix: "/api/v1/services" });
  await app.register(availabilityRoutes, { prefix: "/api/v1/availability" });
  await app.register(bookingRoutes, { prefix: "/api/v1/bookings" });
  await app.register(clientRoutes, { prefix: "/api/v1/clients" });
  await app.register(paymentRoutes, { prefix: "/api/v1/payments" });
  await app.register(cashUpRoutes, { prefix: "/api/v1/cash-up" });
  await app.register(payrollRoutes, { prefix: "/api/v1/payroll" });
  await app.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
  await app.register(publicBookingRoutes, { prefix: "/api/v1/public" });
}
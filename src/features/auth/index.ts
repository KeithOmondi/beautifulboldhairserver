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
import { settingsRoutes } from "../booking-settings/booking-settings.routes";
import { expenseRoutes } from "../expense/expense.routes";
import { sitePublicRoutes } from "../site/site.public.routes";
import { siteStaffRoutes } from "../site/site.staff.routes";
import { analyticsRoutes } from "../site/analytics.routes";
import { timeOffRoutes } from "../time-off/time-off.routes";
import { ledgerRoutes } from "../ledger/ledger.routes";
import { runWithBranchSlug } from "../../utils/branch-context";
import { branchRoutes } from "../branch/branch.routes";
import { shopPublicRoutes } from "../shop/shop.public.routes";
import { shopStaffRoutes } from "../shop/shop.staff.routes";

export async function registerFeatures(app: FastifyInstance) {
  // Public requests say which side of the business they are about with ?branch=slug.
  app.addHook("onRequest", (req, _reply, done) => {
    if (!req.url.startsWith("/api/v1/public")) return done();
    const raw = (req.query as { branch?: unknown } | undefined)?.branch;
    const slug = typeof raw === "string" && /^[a-z0-9-]{1,60}$/i.test(raw) ? raw.toLowerCase() : null;
    runWithBranchSlug(slug, done);
  });
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
  await app.register(settingsRoutes, { prefix: "/api/v1/settings" });
  await app.register(expenseRoutes, { prefix: "/api/v1/expenses" });
  await app.register(timeOffRoutes, { prefix: "/api/v1/time-off" });
  await app.register(publicBookingRoutes, { prefix: "/api/v1/public" });
  await app.register(sitePublicRoutes, { prefix: "/api/v1/public" });
  await app.register(siteStaffRoutes, { prefix: "/api/v1/site" });
  await app.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
  await app.register(ledgerRoutes, { prefix: "/api/v1/ledger" });
  await app.register(branchRoutes, { prefix: "/api/v1/branches" });
  await app.register(shopPublicRoutes, { prefix: "/api/v1/public" });
  await app.register(shopStaffRoutes, { prefix: "/api/v1/shop" });
}

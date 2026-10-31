/**
 * End-to-end API test against a real Postgres.
 *
 *   TEST_DATABASE_URL="postgresql://salon:salon@localhost:5433/salon_test?schema=public" npm test
 *
 * Skipped when TEST_DATABASE_URL is not set. Never point this at a database you care about:
 * it creates its own salon but is not guaranteed to clean up after itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("booking flow (integration)", () => {
  let app: Awaited<ReturnType<typeof import("../app").buildApp>>;
  let prisma: typeof import("../config/db").prisma;
  let addDays: typeof import("../utils/time").addDays;
  let todayString: typeof import("../utils/time").todayString;
  let dayOfWeek: typeof import("../utils/time").dayOfWeek;
  let hashPassword: typeof import("../utils/password").hashPassword;

  const suffix = Math.random().toString(36).slice(2, 8);
  // Unique phones and M-Pesa receipts per run (the test database persists between runs).
  const base = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const P = (n: number) => `0712${base.slice(0, 3)}${String(n).padStart(3, "0")}`;
  const N = (n: number) => `+254${P(n).slice(1)}`;
  const R = (tag: string) => `${tag}${suffix}`.toUpperCase().padEnd(10, "0").slice(0, 10);
  const ownerEmail = `owner-${suffix}@test.local`;
  let ownerCookie = "";
  let workerCookie = "";
  let branchId = "";
  let serviceId = "";
  let staffId = "";
  let otherStaffId = "";
  let date = "";
  let slotA = "";
  let slotB = "";

  const call = (method: string, path: string, opts: { body?: unknown; cookie?: string; query?: Record<string, string> } = {}) =>
    app.inject({
      method: method as "GET",
      url: `/api/v1${path}`,
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    });

  const cookieFrom = (res: { cookies: Array<{ name: string; value: string }> }) =>
    res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const login = async (email: string) => {
    const res = await call("POST", "/auth/login", { body: { email, password: "Password123!" } });
    expect(res.statusCode).toBe(200);
    return cookieFrom(res);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET = "integration-test-secret-integration-test-secret";
    process.env.NODE_ENV = "test";
    // Make sure nothing in a developer's .env talks to real services during tests.
    for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL", "MPESA_CALLBACK_SECRET", "BREVO_API_KEY", "SMS_PROVIDER_API_KEY", "SMS_USERNAME", "TALKSASA_API_TOKEN", "TALKSASA_SENDER_ID", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
      process.env[key] = "";
    }

    ({ prisma } = await import("../config/db"));
    ({ addDays, todayString, dayOfWeek } = await import("../utils/time"));
    ({ hashPassword } = await import("../utils/password"));
    const { buildApp } = await import("../app");
    app = await buildApp();

    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), d === 0 ? null : { start: "09:00", end: "18:00" }]));
    const passwordHash = await hashPassword("Password123!");

    // Clear anything left by earlier runs so "the first active branch" is ours.
    await prisma.branch.updateMany({ data: { isActive: false } });
    const branch = await prisma.branch.create({
      data: {
        name: `Test Salon ${suffix}`,
        settings: { create: { minNoticeHours: 3, maxAheadDays: 60, bufferMinutes: 15, cancelWindowHours: 24, depositRequired: false, depositAmount: 500, maxBookingsPerDay: 2 } },
      },
    });
    branchId = branch.id;

    const mk = (name: string, email: string, phone: string, role: "OWNER" | "WORKER", bookable: boolean) =>
      prisma.staff.create({
        data: { branchId, name, email, phone, passwordHash, role, isBookable: bookable, weeklyHours: hours, payType: "COMMISSION_ONLY", commissionPct: 1500 },
      });
    await mk("Owner", ownerEmail, `+2547${suffix.length}0${Math.floor(Math.random() * 9e6 + 1e6)}`.slice(0, 13), "OWNER", false);
    const stylist = await mk("Test Stylist", `stylist-${suffix}@test.local`, `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`, "WORKER", true);
    const other = await mk("Other Stylist", `other-${suffix}@test.local`, `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`, "WORKER", true);
    staffId = stylist.id;
    otherStaffId = other.id;

    const service = await prisma.service.create({ data: { branchId, name: "Test Lashes", durationMin: 60, price: 3000 } });
    serviceId = service.id;

    // A working day (Mon-Sat) at least 3 days out so notice/horizon rules never interfere.
    for (let i = 3; i < 12; i++) {
      const candidate = addDays(todayString(), i);
      if (dayOfWeek(candidate) !== 0) {
        date = candidate;
        break;
      }
    }

    ownerCookie = await login(ownerEmail);
    workerCookie = await login(`stylist-${suffix}@test.local`);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("rejects requests without a session and accepts the cookie session", async () => {
    expect((await call("GET", "/bookings")).statusCode).toBe(401);
    const me = await call("GET", "/auth/me", { cookie: ownerCookie });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe("OWNER");
  });

  it("exposes the public catalogue and availability without login", async () => {
    const info = await call("GET", "/public/info");
    expect(info.json().name).toBe(`Test Salon ${suffix}`);

    const services = await call("GET", "/public/services");
    expect(services.json().some((s: { id: string }) => s.id === serviceId)).toBe(true);

    const staff = await call("GET", "/public/staff");
    expect(staff.json().map((s: { name: string }) => s.name)).not.toContain("Owner"); // not bookable

    const slots = await call("GET", "/public/availability", { query: { serviceId, date } });
    const list = slots.json().slots as Array<{ startAt: string; startTime: string }>;
    expect(list.length).toBeGreaterThan(10);
    expect(list[0]!.startTime).toBe("09:00");
    slotA = list.find((s) => s.startTime === "10:00")!.startAt;
    slotB = list.find((s) => s.startTime === "14:00")!.startAt;
  });

  it("books without a deposit, and blocks double-booking the same stylist", async () => {
    const body = { serviceId, staffId, startAt: slotA, name: "Ann Test", phone: P(1) };
    const first = await call("POST", "/public/bookings", { body });
    expect(first.statusCode).toBe(201);
    expect(first.json().requiresPayment).toBe(false);
    expect(first.json().manageToken).toMatch(/^[0-9a-f]{48}$/);

    const second = await call("POST", "/public/bookings", { body: { ...body, name: "Bea Test", phone: P(2) } });
    expect(second.statusCode).toBe(409);

    // Slot and its 15-minute buffer disappear for that stylist.
    const after = await call("GET", "/public/availability", { query: { serviceId, date, staffId } });
    const times = (after.json().slots as Array<{ startTime: string }>).map((s) => s.startTime);
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:45");
    expect(times).toContain("11:15");
  });

  it("assigns 'any stylist' to whoever is free", async () => {
    const res = await call("POST", "/public/bookings", { body: { serviceId, startAt: slotA, name: "Cat Test", phone: P(3) } });
    expect(res.statusCode).toBe(201);
    const booking = await prisma.booking.findFirstOrThrow({ where: { client: { phone: N(3) } } });
    expect(booking.staffId).toBe(otherStaffId);
  });

  it("only one of two simultaneous requests wins the last slot", async () => {
    const mkBody = (n: number) => ({ serviceId, staffId, startAt: slotB, name: `Racer ${n}`, phone: P(100 + n) });
    const results = await Promise.all([1, 2, 3, 4].map((n) => call("POST", "/public/bookings", { body: mkBody(n) })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(3);
  });

  it("lets a client view, move and cancel their booking by link", async () => {
    const booking = await prisma.booking.findFirstOrThrow({ where: { client: { phone: N(1) } } });
    const view = await call("GET", `/public/manage/${booking.manageToken}`);
    expect(view.statusCode).toBe(200);
    expect(view.json().canReschedule).toBe(true);

    const slots = await call("GET", "/public/availability", { query: { serviceId, date, staffId } });
    const target = (slots.json().slots as Array<{ startAt: string; startTime: string }>).find((s) => s.startTime === "16:00")!;
    const moved = await call("POST", `/public/manage/${booking.manageToken}/reschedule`, { body: { newStartAt: target.startAt } });
    expect(moved.statusCode).toBe(200);
    expect(new Date(moved.json().startAt).toISOString()).toBe(target.startAt);

    const cancelled = await call("POST", `/public/manage/${booking.manageToken}/cancel`);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect((await call("POST", `/public/manage/${booking.manageToken}/cancel`)).statusCode).toBe(400);
  });

  describe("M-Pesa deposit", () => {
    const stk = (checkoutId: string, code: number, receipt = R("C"), amount = 500) => ({
      Body: {
        stkCallback: {
          MerchantRequestID: "m1",
          CheckoutRequestID: checkoutId,
          ResultCode: code,
          ResultDesc: code === 0 ? "ok" : "Request cancelled by user",
          ...(code === 0 ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }] } } : {}),
        },
      },
    });

    const makeHold = async (startAt: string, phone: string, extra: Record<string, unknown> = {}) =>
      prisma.slotHold.create({
        data: {
          branchId,
          staffId,
          serviceId,
          startAt: new Date(startAt),
          endAt: new Date(new Date(startAt).getTime() + 3_600_000),
          clientPhone: phone,
          clientName: "Dee Deposit",
          depositAmount: 500,
          mpesaCheckoutId: `ws_CO_${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() + 600_000),
          ...extra,
        },
      });

    let slotC = "";
    beforeAll(async () => {
      const slots = await call("GET", "/public/availability", { query: { serviceId, date, staffId } });
      slotC = (slots.json().slots as Array<{ startAt: string; startTime: string }>).find((s) => s.startTime === "12:00")!.startAt;
    });

    it("refuses online deposits when M-Pesa is not configured", async () => {
      await prisma.bookingSettings.update({ where: { branchId }, data: { depositRequired: true } });
      const res = await call("POST", "/public/bookings", { body: { serviceId, staffId, startAt: slotC, name: "Eve", phone: P(9) } });
      expect(res.statusCode).toBe(503);
      // Failing early must not leave a hold blocking the slot.
      expect(await prisma.slotHold.count({ where: { clientPhone: N(9) } })).toBe(0);
    });

    it("turns a successful callback into a confirmed booking + payment, exactly once", async () => {
      const hold = await makeHold(slotC, N(10));
      const payload = stk(hold.mpesaCheckoutId!, 0, R("A"));

      expect((await call("POST", "/public/payment-callback", { body: payload })).json().ResultCode).toBe(0);
      await call("POST", "/public/payment-callback", { body: payload }); // Safaricom retry

      const bookings = await prisma.booking.findMany({ where: { client: { phone: N(10) } }, include: { payments: true } });
      expect(bookings).toHaveLength(1);
      expect(bookings[0]!.depositPaid).toBe(500);
      expect(bookings[0]!.payments).toHaveLength(1);
      expect(bookings[0]!.payments[0]!.kind).toBe("DEPOSIT");

      const status = await call("GET", `/public/holds/${hold.id}`);
      expect(status.json().status).toBe("PAID");
      expect(status.json().booking.manageToken).toBe(bookings[0]!.manageToken);
    });

    it("frees the slot when the client cancels the prompt", async () => {
      const hold = await makeHold(slotC, N(11), { startAt: new Date(Date.now() + 5 * 86_400_000), endAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000) });
      await call("POST", "/public/payment-callback", { body: stk(hold.mpesaCheckoutId!, 1032) });
      const status = await call("GET", `/public/holds/${hold.id}`);
      expect(status.json().status).toBe("FAILED");
    });

    it("books the slot when the payment arrives after we had marked the request failed", async () => {
      const when = new Date(Date.now() + 9 * 86_400_000);
      const hold = await makeHold(when.toISOString(), N(13), { status: "FAILED", failureReason: "The transaction is still under processing", startAt: when, endAt: new Date(when.getTime() + 3_600_000) });
      await call("POST", "/public/payment-callback", { body: stk(hold.mpesaCheckoutId!, 0, R("L")) });
      expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("PAID");
      expect(await prisma.booking.count({ where: { client: { phone: N(13) } } })).toBe(1);
      expect(await prisma.payment.count({ where: { mpesaReceipt: R("L") } })).toBe(1);
    });

    it("never loses money if the slot was taken meanwhile: parks it as an unassigned payment", async () => {
      // slotC is already booked by the earlier test, so a second payer for it must conflict.
      const hold = await makeHold(slotC, N(12));
      await call("POST", "/public/payment-callback", { body: stk(hold.mpesaCheckoutId!, 0, R("B")) });
      expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("CONFLICT");
      const pending = await prisma.pendingPayment.findUnique({ where: { mpesaReceipt: R("B") } });
      expect(pending?.amount).toBe(500);
      expect(pending?.isAssigned).toBe(false);
    });
  });

  describe("front desk", () => {
    let bookingId = "";

    it("creates a walk-in booking for a new client", async () => {
      const slots = await call("GET", "/availability", { cookie: ownerCookie, query: { staffId: otherStaffId, serviceId, date } });
      const start = (slots.json().availableSlots as Array<{ startAt: string; startTime: string }>).find((s) => s.startTime === "13:00")!;
      const res = await call("POST", "/bookings", {
        cookie: ownerCookie,
        body: { staffId: otherStaffId, serviceId, startAt: start.startAt, clientName: "Walk In", clientPhone: P(20), source: "WALKIN" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().balance).toBe(3000);
      bookingId = res.json().id;
    });

    it("checks out with a discount: records the payment and completes the booking", async () => {
      const res = await call("POST", `/bookings/${bookingId}/checkout`, { cookie: ownerCookie, body: { method: "CASH", discount: 500 } });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b.status).toBe("COMPLETED");
      expect(b.paid).toBe(true);
      expect(b.paidTotal).toBe(2500);
      expect(b.balance).toBe(0);
    });

    it("rejects an M-Pesa checkout without a confirmation code", async () => {
      const res = await call("POST", `/bookings/${bookingId}/checkout`, { cookie: ownerCookie, body: { method: "MPESA" } });
      expect(res.statusCode).toBe(400);
    });

    it("refunds a payment once, and only once", async () => {
      const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId, kind: "BALANCE" } });
      expect((await call("POST", `/payments/${payment.id}/refund`, { cookie: ownerCookie })).statusCode).toBe(200);
      expect((await call("POST", `/payments/${payment.id}/refund`, { cookie: ownerCookie })).statusCode).toBe(409);
    });

    it("limits a stylist to their own appointments", async () => {
      const mine = await call("GET", "/bookings", { cookie: workerCookie, query: { date } });
      expect(mine.statusCode).toBe(200);
      for (const b of mine.json()) expect(b.staff.id).toBe(staffId);
      expect((await call("POST", "/bookings", { cookie: workerCookie, body: {} })).statusCode).toBe(403);
      expect((await call("GET", "/dashboard", { cookie: workerCookie })).statusCode).toBe(403);
    });

    it("serves the owner dashboard and settings", async () => {
      const dash = await call("GET", "/dashboard", { cookie: ownerCookie });
      expect(dash.statusCode).toBe(200);
      expect(dash.json().trend).toHaveLength(14);
      expect(dash.json().alerts.unassignedPayments).toBeGreaterThanOrEqual(1);

      const patch = await call("PATCH", "/settings", { cookie: ownerCookie, body: { depositAmount: 700 } });
      expect(patch.json().depositAmount).toBe(700);
      expect(patch.json().name).toBe(`Test Salon ${suffix}`);
    });

    it("blocks a salon closure day from public booking", async () => {
      const closed = addDays(date, 1) === date ? date : addDays(date, 7);
      const res = await call("POST", "/time-off", { cookie: ownerCookie, body: { from: closed, to: closed, reason: "Public holiday" } });
      expect(res.statusCode).toBe(201);
      const slots = await call("GET", "/public/availability", { query: { serviceId, date: closed } });
      expect(slots.json().slots).toEqual([]);
    });
  });

  describe('specialisation', () => {
    it('only assigns stylists who perform the service, and hides names by default', async () => {
      await prisma.bookingSettings.update({ where: { branchId }, data: { depositRequired: false } });
      const second = await prisma.service.create({ data: { branchId, name: 'Test Braids', durationMin: 60, price: 2000 } });
      await prisma.staffService.create({ data: { staffId: otherStaffId, serviceId: second.id } }); // other only does braids

      let day = addDays(date, 8);
      if (dayOfWeek(day) === 0) day = addDays(day, 1);
      const slots = await call('GET', '/public/availability', { query: { serviceId, date: day } });
      const start = (slots.json().slots as Array<{ startAt: string; startTime: string }>).find((s) => s.startTime === '11:00')!;

      // Anyone may be assigned braids; lashes can only go to the unrestricted stylist.
      const lash = await call('POST', '/public/bookings', { body: { serviceId, startAt: start.startAt, name: 'Spec One', phone: P(300) } });
      expect(lash.statusCode).toBe(201);
      const booked = await prisma.booking.findFirstOrThrow({ where: { client: { phone: N(300) } } });
      expect(booked.staffId).toBe(staffId);

      const forced = await call('POST', '/public/bookings', { body: { serviceId, staffId: otherStaffId, startAt: start.startAt, name: 'Spec Two', phone: P(301) } });
      expect(forced.statusCode).toBe(404);

      // Names are hidden until the salon opts in.
      expect((await call('GET', '/public/staff')).json()).toEqual([]);
      await prisma.bookingSettings.update({ where: { branchId }, data: { showStylists: true } });
      const named = (await call('GET', '/public/staff', { query: { serviceId } })).json() as Array<{ id: string }>;
      expect(named.map((n) => n.id)).toEqual([staffId]);
    });
  });
});

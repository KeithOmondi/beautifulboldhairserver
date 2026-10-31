/**
 * Landing page data, reviews, complaints, analytics and permission checks against a real Postgres.
 * Run with TEST_DATABASE_URL set (see booking-flow.test.ts).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("site features (integration)", () => {
  let app: Awaited<ReturnType<typeof import("../app").buildApp>>;
  let prisma: typeof import("../config/db").prisma;

  const suffix = Math.random().toString(36).slice(2, 8);
  const base = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const P = (n: number) => `0713${base.slice(0, 3)}${String(n).padStart(3, "0")}`;
  const N = (n: number) => `+254${P(n).slice(1)}`;

  let ownerCookie = "";
  let workerCookie = "";
  let branchId = "";
  let staffId = "";
  let serviceId = "";

  const call = (method: string, path: string, opts: { body?: unknown; cookie?: string; query?: Record<string, string> } = {}) =>
    app.inject({
      method: method as "GET",
      url: `/api/v1${path}`,
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    });

  const login = async (email: string) => {
    const res = await call("POST", "/auth/login", { body: { email, password: "Password123!" } });
    expect(res.statusCode).toBe(200);
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  };

  let slotOffset = 0;
  const completedBooking = async (phone: string) => {
    const start = Date.now() - 86_400_000 - slotOffset++ * 7_200_000; // each booking in its own free time
    const client = await prisma.client.create({ data: { branchId, name: "Rita Reviewer", phone } });
    return prisma.booking.create({
      data: {
        branchId,
        clientId: client.id,
        staffId,
        serviceId,
        startAt: new Date(start),
        endAt: new Date(start + 3_600_000),
        status: "COMPLETED",
        price: 3000,
        manageToken: randomBytes(24).toString("hex"),
      },
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET = "integration-test-secret-integration-test-secret";
    process.env.NODE_ENV = "test";
    for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL", "MPESA_CALLBACK_SECRET", "BREVO_API_KEY", "SMS_PROVIDER_API_KEY", "SMS_USERNAME", "TALKSASA_API_TOKEN", "TALKSASA_SENDER_ID", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
      process.env[key] = "";
    }

    ({ prisma } = await import("../config/db"));
    const { hashPassword } = await import("../utils/password");
    const { buildApp } = await import("../app");
    app = await buildApp();

    const passwordHash = await hashPassword("Password123!");
    await prisma.branch.updateMany({ data: { isActive: false } });
    const branch = await prisma.branch.create({ data: { name: `Site Test ${suffix}`, settings: { create: {} } } });
    branchId = branch.id;

    const phone = () => `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`;
    await prisma.staff.create({ data: { branchId, name: "Owner", email: `o-${suffix}@test.local`, phone: phone(), passwordHash, role: "OWNER", isBookable: false } });
    const stylist = await prisma.staff.create({
      data: { branchId, name: "Sty List", email: `s-${suffix}@test.local`, phone: phone(), passwordHash, role: "WORKER", commissionPct: 1500, monthlySalary: 20000 },
    });
    staffId = stylist.id;
    serviceId = (await prisma.service.create({ data: { branchId, name: "Site Lashes", durationMin: 60, price: 3000 } })).id;

    ownerCookie = await login(`o-${suffix}@test.local`);
    workerCookie = await login(`s-${suffix}@test.local`);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("serves everything the landing page needs in one cacheable request", async () => {
    const res = await call("GET", "/public/landing");
    expect(res.statusCode).toBe(200);
    expect(res.json().salon.name).toBe(`Site Test ${suffix}`);
    expect(res.json().services.map((s: { name: string }) => s.name)).toContain("Site Lashes");
    expect(res.headers["cache-control"]).toContain("max-age");
  });

  it("lets visitors like and unlike a published photo, never below zero, and ignores hidden photos", async () => {
    const shown = await prisma.galleryImage.create({ data: { branchId, url: `https://res.cloudinary.com/x/image/upload/a-${suffix}.jpg`, publicId: `salon-gallery/a-${suffix}` } });
    const hidden = await prisma.galleryImage.create({ data: { branchId, url: `https://res.cloudinary.com/x/image/upload/b-${suffix}.jpg`, publicId: `salon-gallery/b-${suffix}`, isPublished: false } });

    expect((await call("POST", `/public/gallery/${shown.id}/like`, { body: { action: "like" } })).json().likes).toBe(1);
    expect((await call("POST", `/public/gallery/${shown.id}/like`, { body: { action: "unlike" } })).json().likes).toBe(0);
    expect((await call("POST", `/public/gallery/${shown.id}/like`, { body: { action: "unlike" } })).json().likes).toBe(0);
    expect((await call("POST", `/public/gallery/${hidden.id}/like`, { body: { action: "like" } })).statusCode).toBe(404);
    expect((await call("POST", `/public/gallery/${shown.id}/like`, { body: { action: "explode" } })).statusCode).toBe(400);

    await call("POST", `/public/gallery/${shown.id}/like`, { body: { action: "like" } });
    const landing = (await call("GET", "/public/landing")).json().gallery as Array<{ id: string; likes: number }>;
    expect(landing.find((g) => g.id === shown.id)?.likes).toBe(1);
    expect(landing.some((g) => g.id === hidden.id)).toBe(false);
  });

  it("gives the owner a full payment ledger with names, M-Pesa codes and times, and nobody else", async () => {
    const booking = await completedBooking(N(901));
    const code = `LG${suffix.toUpperCase()}1`;
    const paidAt = new Date(Date.now() - 3_600_000);
    await prisma.payment.create({ data: { branchId, bookingId: booking.id, amount: 500, method: "MPESA", kind: "DEPOSIT", mpesaReceipt: code, mpesaPhone: N(901), mpesaCallbackId: "ws_CO_x", paidAt } });
    await prisma.payment.create({ data: { branchId, bookingId: booking.id, amount: 2500, method: "CASH", kind: "BALANCE", notes: `=HYPERLINK("http://evil")`, recordedBy: staffId } });

    // Only the owner: a stylist is refused, and so is an anonymous visitor.
    expect((await call("GET", "/ledger", { cookie: workerCookie })).statusCode).toBe(403);
    expect((await call("GET", "/ledger")).statusCode).toBe(401);

    const all = (await call("GET", "/ledger", { cookie: ownerCookie })).json();
    const row = all.rows.find((r: { receipt: string | null }) => r.receipt === code);
    expect(row).toMatchObject({ clientName: "Rita Reviewer", amount: 500, method: "MPESA", kind: "DEPOSIT", recordedBy: "M-Pesa (automatic)" });
    expect(new Date(row.paidAt).getTime()).toBe(paidAt.getTime());
    expect(all.totals.collected).toBeGreaterThanOrEqual(3000);
    expect(all.totals.byMethod.CASH).toBeGreaterThanOrEqual(2500);

    // Search by code, by the phone as the owner would type it, and by name.
    for (const q of [code.toLowerCase(), P(901), "rita rev"]) {
      const hit = (await call("GET", "/ledger", { cookie: ownerCookie, query: { q } })).json();
      expect(hit.rows.some((r: { receipt: string | null }) => r.receipt === code)).toBe(true);
    }
    const none = (await call("GET", "/ledger", { cookie: ownerCookie, query: { q: "no-such-person-xyz" } })).json();
    expect(none.total).toBe(0);
    expect((await call("GET", "/ledger", { cookie: ownerCookie, query: { method: "BITCOIN" } })).statusCode).toBe(400);

    // Spreadsheet export: formulas are defused so opening the file can't run anything.
    const csv = await call("GET", "/ledger/export.csv", { cookie: ownerCookie });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body).toContain(code);
    expect(csv.body).toContain(`'=HYPERLINK`);
    expect(csv.body).not.toMatch(/,=HYPERLINK/);
    expect((await call("GET", "/ledger/export.csv", { cookie: workerCookie })).statusCode).toBe(403);
  });

  describe("collecting what clients still owe", () => {
    const stk = (checkoutId: string, receipt: string, amount: number, code = 0) => ({
      Body: {
        stkCallback: {
          MerchantRequestID: "m1",
          CheckoutRequestID: checkoutId,
          ResultCode: code,
          ResultDesc: code === 0 ? "ok" : "Request cancelled by user",
          ...(code === 0 ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }, { Name: "TransactionDate", Value: 20261030101530 }] } } : {}),
        },
      },
    });
    const owingBooking = async (n: number) => {
      const b = await completedBooking(N(n));
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED", price: 3000 } });
      return b;
    };
    const sentPrompt = (bookingId: string, amount: number) =>
      prisma.paymentRequest.create({ data: { branchId, bookingId, amount, phone: N(0), mpesaCheckoutId: `ws_CO_${randomBytes(6).toString("hex")}` } });

    it("refuses to send a prompt when M-Pesa is not set up, with a helpful message", async () => {
      const b = await owingBooking(910);
      const res = await call("POST", `/bookings/${b.id}/request-payment`, { cookie: ownerCookie, body: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("cash");
      expect((await call("POST", `/bookings/${b.id}/request-payment`, { cookie: workerCookie, body: {} })).statusCode).toBe(403);
    });

    it("records the balance, with the M-Pesa time, when the client pays the prompt (and only once)", async () => {
      const b = await owingBooking(911);
      const req = await sentPrompt(b.id, 3000);
      const receipt = `BL${suffix.toUpperCase()}1`.slice(0, 10).padEnd(10, "X");
      const payload = stk(req.mpesaCheckoutId!, receipt, 3000);
      await call("POST", "/public/payment-callback", { body: payload });
      await call("POST", "/public/payment-callback", { body: payload }); // Safaricom retry

      const payments = await prisma.payment.findMany({ where: { bookingId: b.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ amount: 3000, method: "MPESA", kind: "BALANCE", mpesaReceipt: receipt });
      expect(payments[0]!.paidAt.toISOString()).toBe("2026-10-30T07:15:30.000Z"); // 10:15:30 Nairobi
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).paid).toBe(true);
      expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PAID");
    });

    it("keeps the booking open after a part payment", async () => {
      const b = await owingBooking(912);
      const req = await sentPrompt(b.id, 1000);
      await call("POST", "/public/payment-callback", { body: stk(req.mpesaCheckoutId!, `PT${suffix.toUpperCase()}12`.padEnd(10, "X").slice(0, 10), 1000) });
      const booking = (await call("GET", `/bookings/${b.id}`, { cookie: ownerCookie })).json();
      expect(booking.balance).toBe(2000);
      expect(booking.paid).toBe(false);
    });

    it("marks the prompt failed when the client cancels, and records nothing", async () => {
      const b = await owingBooking(913);
      const req = await sentPrompt(b.id, 3000);
      await call("POST", "/public/payment-callback", { body: stk(req.mpesaCheckoutId!, "", 0, 1032) });
      expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FAILED");
      expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(0);
    });

    it("never loses the money when the booking was paid in cash while the prompt was open", async () => {
      const b = await owingBooking(914);
      const req = await sentPrompt(b.id, 3000);
      await call("POST", `/bookings/${b.id}/checkout`, { cookie: ownerCookie, body: { method: "CASH" } });
      const receipt = `LT${suffix.toUpperCase()}14`.padEnd(10, "X").slice(0, 10);
      await call("POST", "/public/payment-callback", { body: stk(req.mpesaCheckoutId!, receipt, 3000) });
      expect(await prisma.payment.count({ where: { bookingId: b.id, method: "MPESA" } })).toBe(0); // no overpayment on the books
      expect((await prisma.pendingPayment.findUnique({ where: { mpesaReceipt: receipt } }))?.amount).toBe(3000); // parked for a refund
      expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONFLICT");
    });

    it("takes cash in part payments and no longer accepts card", async () => {
      const b = await owingBooking(915);
      const part = await call("POST", `/bookings/${b.id}/checkout`, { cookie: ownerCookie, body: { method: "CASH", amount: 1000, notes: "Cash given 2000, change 1000" } });
      expect(part.statusCode).toBe(200);
      expect(part.json().balance).toBe(2000);
      expect(part.json().status).not.toBe("COMPLETED");
      const rest = await call("POST", `/bookings/${b.id}/checkout`, { cookie: ownerCookie, body: { method: "CASH" } });
      expect(rest.json().balance).toBe(0);
      expect(rest.json().status).toBe("COMPLETED");

      const other = await owingBooking(916);
      expect((await call("POST", `/bookings/${other.id}/checkout`, { cookie: ownerCookie, body: { method: "CARD" } })).statusCode).toBe(400);
      expect((await call("POST", "/payments", { cookie: ownerCookie, body: { bookingId: other.id, amount: 100, method: "CARD", kind: "BALANCE" } })).statusCode).toBe(400);
    });
  });

  it("serves robots.txt and sitemap.xml, keeping the staff area out of search engines", async () => {
    const robots = await app.inject({ url: "/robots.txt" });
    expect(robots.body).toContain("Disallow: /app");
    const sitemap = await app.inject({ url: "/sitemap.xml" });
    expect(sitemap.body).toContain("<urlset");
  });

  it("collects cookie-free analytics and reports a funnel to the owner", async () => {
    const sessionId = `sess-${suffix}-abcdefgh`;
    const headers = { "user-agent": "Mozilla/5.0 (iPhone) Mobile Safari", "content-type": "application/json" };
    for (const type of ["page_view", "service_selected"]) {
      const r = await app.inject({ method: "POST", url: "/api/v1/public/track", headers, payload: { type, path: "/book", sessionId, referrer: "https://www.instagram.com/p/x" } });
      expect(r.statusCode).toBe(204);
    }
    // Junk and bots never error and never count.
    expect((await app.inject({ method: "POST", url: "/api/v1/public/track", headers, payload: { type: "nope" } })).statusCode).toBe(204);
    const bot = await app.inject({ method: "POST", url: "/api/v1/public/track", headers: { "user-agent": "Googlebot", "content-type": "application/json" }, payload: { type: "page_view", path: "/", sessionId: "bot-session-1" } });
    expect(bot.statusCode).toBe(204);
    expect(await prisma.analyticsEvent.count({ where: { sessionId: "bot-session-1" } })).toBe(0);

    const report = (await call("GET", "/analytics", { cookie: ownerCookie, query: { days: "7" } })).json();
    expect(report.traffic.visitors).toBeGreaterThanOrEqual(1);
    expect(report.traffic.funnel[1].label).toBe("Chose a service");
    expect(report.traffic.sources.map((x: { name: string }) => x.name)).toContain("instagram.com");
    expect(report.traffic.devices.map((x: { name: string }) => x.name)).toContain("mobile");
    expect(report.business.byWeekday).toHaveLength(7);
    expect((await call("GET", "/analytics", { cookie: workerCookie })).statusCode).toBe(403);
  });

  /** Walks the real flow: ask for a code, read it from the dev SMS log, confirm it, and get the review key. */
  const verifiedKey = async (token: string) => {
    const spy = vi.spyOn(console, "log");
    try {
      expect((await call("POST", `/public/review/${token}/send-code`)).statusCode).toBe(200);
      const line = spy.mock.calls.map((c) => String(c[0])).reverse().find((l) => l.includes("your review code is"))!;
      const code = /code is (\d{6})/.exec(line)![1]!;
      const res = await call("POST", `/public/review/${token}/verify`, { body: { code } });
      expect(res.statusCode).toBe(200);
      return res.json().key as string;
    } finally {
      spy.mockRestore();
    }
  };

  it("turns a low rating into a complaint, and shows good reviews only after the owner approves them", async () => {
    const bad = await completedBooking(N(400));
    expect((await call("GET", `/public/review/${bad.manageToken}`)).json().canReview).toBe(true);
    const badKey = await verifiedKey(bad.manageToken);
    expect((await call("POST", `/public/review/${bad.manageToken}`, { body: { rating: 1, comment: "Waited too long", key: badKey } })).statusCode).toBe(201);
    expect((await call("POST", `/public/review/${bad.manageToken}`, { body: { rating: 5, key: badKey } })).statusCode).toBe(409);
    const complaints = (await call("GET", "/site/complaints", { cookie: ownerCookie })).json() as Array<{ message: string }>;
    expect(complaints.some((c) => c.message.includes("Low rating (1/5)"))).toBe(true);

    const good = await completedBooking(N(401));
    await call("POST", `/public/review/${good.manageToken}`, { body: { rating: 5, comment: "Beautiful lashes, lovely team!", key: await verifiedKey(good.manageToken) } });
    expect(((await call("GET", "/public/landing")).json().reviews as unknown[]).length).toBe(0); // not approved yet

    const list = (await call("GET", "/site/reviews", { cookie: ownerCookie })).json() as Array<{ id: string; rating: number; verifiedAt: string | null }>;
    const fiveStar = list.find((r) => r.rating === 5)!;
    expect(fiveStar.verifiedAt).not.toBeNull();
    expect((await call("PATCH", `/site/reviews/${fiveStar.id}`, { cookie: ownerCookie, body: { isPublished: true } })).statusCode).toBe(200);
    const shown = (await call("GET", "/public/landing")).json().reviews as Array<{ name: string; comment: string }>;
    expect(shown[0]!.name).toBe("Rita R."); // only first name + initial is ever public
    expect(shown[0]!.comment).toContain("Beautiful");
  });

  it("refuses a review from anyone who only has the link, and limits wrong guesses", async () => {
    const b = await completedBooking(N(410));
    // The link alone is not enough.
    const noKey = await call("POST", `/public/review/${b.manageToken}`, { body: { rating: 5, comment: "Fake" } });
    expect(noKey.statusCode).toBe(403);
    expect((await call("POST", `/public/review/${b.manageToken}`, { body: { rating: 5, key: "9999999999999.deadbeef" } })).statusCode).toBe(403);
    // A key made for another appointment does not work here.
    const other = await completedBooking(N(411));
    const otherKey = await verifiedKey(other.manageToken);
    expect((await call("POST", `/public/review/${b.manageToken}`, { body: { rating: 5, key: otherKey } })).statusCode).toBe(403);

    // Wrong codes are rejected and eventually lock the code.
    expect((await call("POST", `/public/review/${b.manageToken}/send-code`)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await call("POST", `/public/review/${b.manageToken}/verify`, { body: { code: "000000" } })).statusCode).toBe(400);
    expect((await call("POST", `/public/review/${b.manageToken}/verify`, { body: { code: "000000" } })).json().error).toBe("CODE_EXPIRED");
    // Asking again straight away is throttled.
    expect((await call("POST", `/public/review/${b.manageToken}/send-code`)).statusCode).toBe(429);
    // Nothing was recorded.
    expect(await prisma.feedback.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it("lets only the owner reject a review, keeps it out of the rating, and records who did it", async () => {
    const b = await completedBooking(N(420));
    await call("POST", `/public/review/${b.manageToken}`, { body: { rating: 5, comment: "Great", key: await verifiedKey(b.manageToken) } });
    const row = await prisma.feedback.findFirstOrThrow({ where: { bookingId: b.id } });
    const counted = () => prisma.feedback.count({ where: { removedAt: null } });
    const before = await counted();

    expect((await call("POST", `/site/reviews/${row.id}/reject`, { cookie: workerCookie, body: { reason: "Not a real client" } })).statusCode).toBe(403);
    expect((await call("POST", `/site/reviews/${row.id}/reject`, { cookie: ownerCookie, body: { reason: "x" } })).statusCode).toBe(400);
    expect((await call("POST", `/site/reviews/${row.id}/reject`, { cookie: ownerCookie, body: { reason: "Not a real client" } })).statusCode).toBe(200);
    expect(await counted()).toBe(before - 1);
    // A rejected review cannot be published until restored.
    expect((await call("PATCH", `/site/reviews/${row.id}`, { cookie: ownerCookie, body: { isPublished: true } })).statusCode).toBe(409);
    expect(await prisma.auditLog.count({ where: { entity: "Feedback", entityId: row.id } })).toBe(1);
    expect((await call("POST", `/site/reviews/${row.id}/restore`, { cookie: ownerCookie })).statusCode).toBe(200);
    expect(await counted()).toBe(before);
  });

  it("lets the owner set opening days and hours, shows them publicly, and rejects nonsense", async () => {
    const hours = Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, { start: "09:00", end: "17:00" }]));
    expect((await call("PATCH", "/settings", { cookie: ownerCookie, body: { openingHours: { "1": { start: "17:00", end: "09:00" } } } })).statusCode).toBe(400);
    expect((await call("PATCH", "/settings", { cookie: ownerCookie, body: { openingHours: { "1": null } } })).statusCode).toBe(400); // nothing open
    expect((await call("PATCH", "/settings", { cookie: workerCookie, body: { openingHours: hours } })).statusCode).toBe(403);
    const saved = await call("PATCH", "/settings", { cookie: ownerCookie, body: { openingHours: hours } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().openingHours["5"]).toEqual({ start: "09:00", end: "17:00" });
    expect((await call("GET", "/public/landing")).json().salon.hoursText).toBe("Mon to Fri: 9 am to 5 pm");
    // Saving other settings must not wipe the hours.
    await call("PATCH", "/settings", { cookie: ownerCookie, body: { bufferMinutes: 10 } });
    expect((await call("GET", "/settings", { cookie: ownerCookie })).json().openingHours["1"]).toBeTruthy();
    expect((await call("PATCH", "/settings", { cookie: ownerCookie, body: { openingHours: null } })).json().openingHours).toBeNull();
  });

  it("totals everything one client paid on a single line, deposit and balance together", async () => {
    const b = await completedBooking(N(430));
    await prisma.payment.createMany({
      data: [
        { branchId, bookingId: b.id, amount: 1000, method: "MPESA", kind: "DEPOSIT", mpesaReceipt: `TOT${N(430).slice(-6)}A` },
        { branchId, bookingId: b.id, amount: 2000, method: "CASH", kind: "BALANCE" },
      ],
    });
    expect((await call("GET", "/ledger/by-client", { cookie: workerCookie })).statusCode).toBe(403);
    const res = (await call("GET", "/ledger/by-client", { cookie: ownerCookie, query: { q: N(430).slice(-8) } })).json();
    expect(res.clients).toHaveLength(1);
    expect(res.clients[0]).toMatchObject({ paid: 3000, refunded: 0, net: 3000 });
    expect(res.clients[0].bookings[0]).toMatchObject({ due: 3000, paid: 3000, balance: 0 });
    expect(res.clients[0].bookings[0].payments).toHaveLength(2);
  });

  it("runs an offer: clients see the normal price crossed out and are charged the offer price", async () => {
    const svc = await call("POST", "/services", { cookie: ownerCookie, body: { name: `Offer cut ${N(440)}`, durationMin: 30, price: 2000, salePrice: 1500, category: "Cuts" } });
    expect(svc.statusCode).toBe(201);
    const id = svc.json().id as string;
    expect((await call("POST", "/services", { cookie: ownerCookie, body: { name: `Bad offer ${N(441)}`, durationMin: 30, price: 2000, salePrice: 2500 } })).statusCode).toBe(400);

    const listed = ((await call("GET", "/public/services")).json() as Array<{ id: string; price: number; wasPrice: number | null; category: string | null }>).find((x) => x.id === id)!;
    expect(listed).toMatchObject({ price: 1500, wasPrice: 2000, category: "Cuts" });
    const landing = ((await call("GET", "/public/landing")).json().services as Array<{ id: string; price: number; wasPrice: number | null }>).find((x) => x.id === id)!;
    expect(landing).toMatchObject({ price: 1500, wasPrice: 2000 });

    // Ending the offer restores the normal price everywhere.
    expect((await call("PATCH", `/services/${id}`, { cookie: ownerCookie, body: { salePrice: null } })).statusCode).toBe(200);
    const after = ((await call("GET", "/public/services")).json() as Array<{ id: string; price: number; wasPrice: number | null }>).find((x) => x.id === id)!;
    expect(after).toMatchObject({ price: 2000, wasPrice: null });
  });

  it("lets the owner run home page banners, in order, on a schedule, and only safe links", async () => {
    const img = "https://res.cloudinary.com/demo/image/upload/v1/salon/banner.jpg";
    const post = (body: Record<string, unknown>) => call("POST", "/site/hero", { cookie: ownerCookie, body: { kind: "PHOTO_TEXT", imageUrl: img, ...body } });

    expect((await call("POST", "/site/hero", { cookie: workerCookie, body: { kind: "DESIGNED", imageUrl: img } })).statusCode).toBe(403);
    expect((await post({ headline: "" })).statusCode).toBe(400); // a photo banner needs a headline
    expect((await post({ headline: "Hi", imageUrl: "https://evil.example/x.jpg" })).statusCode).toBe(400); // only our own uploads
    expect((await post({ headline: "Hi", buttonLabel: "Go", linkTo: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await post({ headline: "Hi", buttonLabel: "Go" })).statusCode).toBe(400); // button needs somewhere to go

    const a = await post({ headline: "Weekend offer", subtext: "20% off installs", buttonLabel: "Book now", linkTo: "/book", align: "center" });
    expect(a.statusCode).toBe(201);
    const b = await call("POST", "/site/hero", { cookie: ownerCookie, body: { kind: "DESIGNED", imageUrl: img, linkTo: "/shop?sale=1", headline: "ignored" } });
    expect(b.statusCode).toBe(201);
    expect(b.json().headline).toBeNull(); // a finished design carries its own words
    const future = await post({ headline: "Coming soon", startsOn: "2099-01-01" });
    const past = await post({ headline: "Over", endsOn: "2020-01-01" });
    expect(future.statusCode).toBe(201);
    expect(past.statusCode).toBe(201);

    const live = ((await call("GET", "/public/landing")).json().hero as Array<{ headline: string | null; kind: string; image: string }>);
    expect(live.map((h) => h.kind)).toEqual(["PHOTO_TEXT", "DESIGNED"]); // not the future or expired ones
    expect(live[0]).toMatchObject({ headline: "Weekend offer", image: expect.stringContaining("w_1920") });

    // Reorder, then hide one.
    const ids = [b.json().id, a.json().id];
    expect((await call("PUT", "/site/hero/order", { cookie: ownerCookie, body: { ids } })).statusCode).toBe(200);
    expect(((await call("GET", "/public/landing")).json().hero as Array<{ kind: string }>).map((h) => h.kind)).toEqual(["DESIGNED", "PHOTO_TEXT"]);
    expect((await call("PATCH", `/site/hero/${a.json().id}`, { cookie: ownerCookie, body: { kind: "PHOTO_TEXT", imageUrl: img, headline: "Weekend offer", isActive: false } })).statusCode).toBe(200);
    expect(((await call("GET", "/public/landing")).json().hero as unknown[]).length).toBe(1);
    expect((await call("DELETE", `/site/hero/${b.json().id}`, { cookie: ownerCookie })).statusCode).toBe(200);
  });

  it("accepts complaints from the public and lets the team resolve them", async () => {
    expect((await call("POST", "/public/complaints", { body: { name: "A", phone: P(500), message: "short" } })).statusCode).toBe(400);
    const ok = await call("POST", "/public/complaints", { body: { name: "Carol Complainer", phone: P(500), category: "SERVICE", message: "My appointment started 40 minutes late." } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().reference).toMatch(/^[A-Z0-9]{6}$/);

    const open = (await call("GET", "/site/complaints", { cookie: ownerCookie, query: { status: "OPEN" } })).json() as Array<{ id: string; name: string }>;
    const mine = open.find((c) => c.name === "Carol Complainer")!;
    const resolved = await call("PATCH", `/site/complaints/${mine.id}`, { cookie: ownerCookie, body: { status: "RESOLVED", resolutionNote: "Apologised and gave a discount" } });
    expect(resolved.json().status).toBe("RESOLVED");
    expect(resolved.json().resolvedAt).toBeTruthy();
  });

  it("refuses gallery uploads that did not come from our Cloudinary account", async () => {
    expect((await call("POST", "/site/gallery/sign", { cookie: ownerCookie })).statusCode).toBe(503); // not configured in tests
    const foreign = await call("POST", "/site/gallery", { cookie: ownerCookie, body: { publicId: "salon-gallery/abc123", url: "https://evil.example/x.jpg" } });
    expect(foreign.statusCode).toBe(400);
    expect((await call("GET", "/site/gallery", { cookie: workerCookie })).statusCode).toBe(403);
  });

  it("keeps client contact details and colleagues' pay away from stylists", async () => {
    expect((await call("GET", "/clients", { cookie: workerCookie })).statusCode).toBe(403);
    const list = (await call("GET", "/staff", { cookie: workerCookie })).json() as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s).not.toHaveProperty("email");
      expect(s).not.toHaveProperty("monthlySalary");
      expect(s).not.toHaveProperty("commissionPct");
    }
  });
});

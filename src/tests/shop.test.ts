/**
 * Online shop: inventory, checkout, stock safety, M-Pesa and cash payment, cancellation and permissions.
 * Run with TEST_DATABASE_URL set (see booking-flow.test.ts).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("shop (integration)", () => {
  let app: Awaited<ReturnType<typeof import("../app").buildApp>>;
  let prisma: typeof import("../config/db").prisma;
  const suffix = Math.random().toString(36).slice(2, 8);
  const base = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const P = (n: number) => `0714${base.slice(0, 3)}${String(n).padStart(3, "0")}`;

  let ownerCookie = "";
  let workerCookie = "";
  let receptionCookie = "";
  let branchId = "";

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

  const product = async (over: Record<string, unknown> = {}) => {
    const res = await call("POST", "/shop/products", {
      cookie: ownerCookie,
      body: { name: `Wig ${randomBytes(3).toString("hex")}`, category: "Bob wigs", costPrice: 2000, salePrice: 3500, quantity: 5, isPublished: true, ...over },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; quantity: number };
  };
  const stockOf = async (id: string) => (await prisma.stockItem.findUniqueOrThrow({ where: { id } })).quantity;
  const checkoutBody = (items: Array<{ id: string; qty: number }>, over: Record<string, unknown> = {}) => ({
    items,
    name: "Shop Customer",
    phone: P(1),
    fulfilment: "DELIVERY",
    address: "Biashara Street, Hison Plaza",
    payMethod: "ON_DELIVERY",
    ...over,
  });

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
    const branch = await prisma.branch.create({ data: { name: `Shop Test ${suffix}`, phone: "0700000000", settings: { create: { shopDeliveryFee: 300, shopFreeOver: 10000 } } } });
    branchId = branch.id;
    const phone = () => `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`;
    const mk = (n: string, role: "OWNER" | "WORKER" | "RECEPTIONIST") =>
      prisma.staff.create({ data: { branchId, name: n, email: `${n}-${suffix}@test.local`, phone: phone(), passwordHash, role, isBookable: false } });
    await mk("o", "OWNER");
    await mk("w", "WORKER");
    await mk("r", "RECEPTIONIST");
    ownerCookie = await login(`o-${suffix}@test.local`);
    workerCookie = await login(`w-${suffix}@test.local`);
    receptionCookie = await login(`r-${suffix}@test.local`);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("keeps cost price and exact stock private, and only shows published products", async () => {
    const shown = await product({ name: "Visible Bob", quantity: 2, compareAtPrice: 5000 });
    const hidden = await product({ name: "Hidden Draft", isPublished: false });
    const list = (await call("GET", "/public/shop/products")).json() as { products: Array<Record<string, unknown>> };
    const names = list.products.map((p) => p.name);
    expect(names).toContain("Visible Bob");
    expect(names).not.toContain("Hidden Draft");
    const row = list.products.find((p) => p.name === "Visible Bob")!;
    expect(row).toMatchObject({ price: 3500, wasPrice: 5000, discountPct: 30, inStock: true, left: 2 });
    expect(JSON.stringify(row)).not.toContain("costPrice");
    expect((await call("GET", `/public/shop/products/${hidden.id}`)).statusCode).toBe(404);
    expect((await call("GET", `/public/shop/products/${shown.id}`)).statusCode).toBe(200);
  });

  it("only managers can manage inventory; the offer price must be an actual discount", async () => {
    expect((await call("GET", "/shop/products", { cookie: workerCookie })).statusCode).toBe(403);
    expect((await call("GET", "/shop/products", { cookie: receptionCookie })).statusCode).toBe(403);
    const bad = await call("POST", "/shop/products", { cookie: ownerCookie, body: { name: "Bad offer", salePrice: 3000, compareAtPrice: 2000 } });
    expect(bad.statusCode).toBe(400);
  });

  it("takes an order, reduces stock, charges delivery, and gives the customer a tracking link", async () => {
    const p = await product({ quantity: 5 });
    const res = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 2 }]) });
    expect(res.statusCode).toBe(201);
    expect(res.json().requiresPayment).toBe(false);
    expect(await stockOf(p.id)).toBe(3);

    const track = (await call("GET", `/public/shop/orders/${res.json().token}`)).json();
    expect(track).toMatchObject({ status: "CONFIRMED", subtotal: 7000, deliveryFee: 300, total: 7300, paymentStatus: "UNPAID" });
    expect(track.label).toMatch(/^WO-\d{4,}$/);
  });

  it("waives delivery above the free-delivery amount and for collection", async () => {
    const p = await product({ quantity: 10, salePrice: 6000 });
    const big = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 2 }], { phone: P(2) }) });
    expect((await call("GET", `/public/shop/orders/${big.json().token}`)).json()).toMatchObject({ subtotal: 12000, deliveryFee: 0 });
    const pickup = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(3), fulfilment: "PICKUP", address: undefined }) });
    expect((await call("GET", `/public/shop/orders/${pickup.json().token}`)).json()).toMatchObject({ deliveryFee: 0, total: 6000 });
  });

  it("never sells more than is in stock, even to two customers at once", async () => {
    const p = await product({ quantity: 1 });
    const results = await Promise.all([
      call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(4) }) }),
      call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(5) }) }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await stockOf(p.id)).toBe(0);
    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(6) }) })).json().error).toBe("OUT_OF_STOCK");
    const shown = (await call("GET", "/public/shop/products")).json().products.find((x: { id: string }) => x.id === p.id);
    expect(shown.inStock).toBe(false);
  });

  it("rejects bad checkouts: empty bag, bad phone, missing address, unavailable items", async () => {
    const p = await product();
    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([]) })).statusCode).toBe(400);
    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: "123" }) })).statusCode).toBe(400);
    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { address: "" }) })).statusCode).toBe(400);
    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: "nope", qty: 1 }]) })).statusCode).toBe(409);
    // M-Pesa is not configured in tests: the customer is told, and no stock is held.
    const before = await stockOf(p.id);
    const mp = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { payMethod: "MPESA" }) });
    expect(mp.statusCode).toBe(503);
    expect(await stockOf(p.id)).toBe(before);
  });

  it("confirms an M-Pesa order from the callback, records the payment once, and parks short payments", async () => {
    const p = await product({ quantity: 4, salePrice: 1000 });
    const mk = async (phone: string, id: string) => {
      const o = await prisma.shopOrder.create({
        data: { branchId, token: randomBytes(24).toString("hex"), name: "Mpesa Buyer", phone: `+254${phone.slice(1)}`, fulfilment: "PICKUP", subtotal: 2000, total: 2000, payMethod: "MPESA", mpesaCheckoutId: id, expiresAt: new Date(Date.now() + 600_000), items: { create: [{ stockItemId: p.id, name: "x", unitPrice: 1000, quantity: 2 }] } },
      });
      await prisma.stockItem.update({ where: { id: p.id }, data: { quantity: { decrement: 2 } } });
      return o;
    };
    const cb = (id: string, amount: number, receipt: string, code = 0) =>
      call("POST", "/public/payment-callback", {
        body: { Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: id, ResultCode: code, ResultDesc: code ? "Cancelled" : "ok", ...(code ? {} : { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }, { Name: "PhoneNumber", Value: 254714000001 }] } }) } } },
      });

    const ok = await mk(P(10), `ws_${suffix}_ok`);
    const rc = `SHP${randomBytes(3).toString("hex").toUpperCase()}`;
    expect((await cb(`ws_${suffix}_ok`, 2000, rc)).statusCode).toBe(200);
    await cb(`ws_${suffix}_ok`, 2000, rc); // delivered twice
    expect(await prisma.payment.count({ where: { shopOrderId: ok.id } })).toBe(1);
    expect(await prisma.shopOrder.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    const ledger = (await call("GET", "/ledger", { cookie: ownerCookie })).json().rows.find((r: { receipt: string }) => r.receipt === rc);
    expect(ledger).toMatchObject({ amount: 2000, method: "MPESA", clientName: "Mpesa Buyer" });
    expect(ledger.service).toMatch(/^Shop order WO-/);

    const short = await mk(P(11), `ws_${suffix}_short`);
    const rc2 = `SHP${randomBytes(3).toString("hex").toUpperCase()}`;
    await cb(`ws_${suffix}_short`, 500, rc2);
    expect(await prisma.payment.count({ where: { shopOrderId: short.id } })).toBe(0);
    expect(await prisma.pendingPayment.count({ where: { mpesaReceipt: rc2 } })).toBe(1);

    // A customer who cancels the prompt frees the stock.
    const before = await stockOf(p.id);
    const cancelled = await mk(P(12), `ws_${suffix}_no`);
    expect(await stockOf(p.id)).toBe(before - 2);
    await cb(`ws_${suffix}_no`, 0, "", 1032);
    expect(await prisma.shopOrder.findUniqueOrThrow({ where: { id: cancelled.id } })).toMatchObject({ status: "CANCELLED", paymentStatus: "FAILED" });
    expect(await stockOf(p.id)).toBe(before);
  });

  it("returns stock from checkouts nobody paid for", async () => {
    const { expireStaleOrders } = await import("../features/shop/shop.service");
    const p = await product({ quantity: 3 });
    const o = await prisma.shopOrder.create({
      data: { branchId, token: randomBytes(24).toString("hex"), name: "Walked Away", phone: "+254700123456", fulfilment: "PICKUP", subtotal: 3500, total: 3500, payMethod: "MPESA", expiresAt: new Date(Date.now() - 60_000), items: { create: [{ stockItemId: p.id, name: "x", unitPrice: 3500, quantity: 1 }] } },
    });
    await prisma.stockItem.update({ where: { id: p.id }, data: { quantity: { decrement: 1 } } });
    await expireStaleOrders();
    expect(await prisma.shopOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await stockOf(p.id)).toBe(3);
    await expireStaleOrders(); // running again must not return the stock twice
    expect(await stockOf(p.id)).toBe(3);
  });

  it("lets the front desk take cash, move the order along, and cancel it with stock coming back", async () => {
    const p = await product({ quantity: 6 });
    const order = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 2 }], { phone: P(20) }) });
    const id = (await prisma.shopOrder.findUniqueOrThrow({ where: { token: order.json().token } })).id;

    expect((await call("PATCH", `/shop/orders/${id}/status`, { cookie: workerCookie, body: { status: "READY" } })).statusCode).toBe(403);
    expect((await call("PATCH", `/shop/orders/${id}/status`, { cookie: receptionCookie, body: { status: "COMPLETED" } })).statusCode).toBe(409); // unpaid
    expect((await call("PATCH", `/shop/orders/${id}/status`, { cookie: receptionCookie, body: { status: "READY" } })).statusCode).toBe(200);
    expect((await call("POST", `/shop/orders/${id}/mark-paid`, { cookie: receptionCookie, body: { method: "CASH" } })).statusCode).toBe(200);
    expect((await call("POST", `/shop/orders/${id}/mark-paid`, { cookie: receptionCookie, body: { method: "CASH" } })).statusCode).toBe(409); // not twice
    expect((await call("PATCH", `/shop/orders/${id}/status`, { cookie: receptionCookie, body: { status: "COMPLETED" } })).statusCode).toBe(200);
    expect(await prisma.payment.findFirstOrThrow({ where: { shopOrderId: id } })).toMatchObject({ method: "CASH", amount: 7300 });
    expect((await call("POST", `/shop/orders/${id}/cancel`, { cookie: receptionCookie, body: { reason: "Changed mind" } })).statusCode).toBe(409); // completed

    const second = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 3 }], { phone: P(21) }) });
    const id2 = (await prisma.shopOrder.findUniqueOrThrow({ where: { token: second.json().token } })).id;
    expect(await stockOf(p.id)).toBe(1);
    const cancel = await call("POST", `/shop/orders/${id2}/cancel`, { cookie: receptionCookie, body: { reason: "Customer unreachable" } });
    expect(cancel.statusCode).toBe(200);
    expect(await stockOf(p.id)).toBe(4);
    expect((await call("POST", `/shop/orders/${id2}/cancel`, { cookie: receptionCookie, body: { reason: "again" } })).statusCode).toBe(409);
    expect(await stockOf(p.id)).toBe(4);
  });

  it("adjusts stock with a trail, never below zero, and archives products that have orders", async () => {
    const p = await product({ quantity: 2 });
    expect((await call("POST", `/shop/products/${p.id}/stock`, { cookie: ownerCookie, body: { delta: -3, reason: "Damaged" } })).statusCode).toBe(409);
    expect((await call("POST", `/shop/products/${p.id}/stock`, { cookie: ownerCookie, body: { delta: 5, reason: "Restock" } })).json().quantity).toBe(7);
    const moves = (await call("GET", `/shop/products/${p.id}/movements`, { cookie: ownerCookie })).json() as Array<{ reason: string; delta: number }>;
    expect(moves.map((m) => m.reason)).toEqual(expect.arrayContaining(["Opening stock", "Restock"]));

    expect((await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(30) }) })).statusCode).toBe(201);
    const del = await call("DELETE", `/shop/products/${p.id}`, { cookie: ownerCookie });
    expect(del.json().archived).toBe(true);
    expect((await call("GET", `/public/shop/products/${p.id}`)).statusCode).toBe(404);

    const fresh = await product({ name: "Never sold" });
    expect((await call("DELETE", `/shop/products/${fresh.id}`, { cookie: ownerCookie })).json().archived).toBe(false);
  });

  it("still completes an order when the money arrives after we had given up on it", async () => {
    const p = await product({ quantity: 3, salePrice: 1000 });
    const mk = async (checkout: string) => {
      // An order we auto-cancelled (stock already back on the shelf), as the status check or timeout leaves it.
      return prisma.shopOrder.create({
        data: { branchId, token: randomBytes(24).toString("hex"), name: "Late Payer", phone: "+254714000777", fulfilment: "PICKUP", subtotal: 2000, total: 2000, payMethod: "MPESA", status: "CANCELLED", paymentStatus: "FAILED", cancelReason: "The transaction is still under processing", mpesaCheckoutId: checkout, items: { create: [{ stockItemId: p.id, name: "x", unitPrice: 1000, quantity: 2 }] } },
      });
    };
    const cb = (id: string, receipt: string) =>
      call("POST", "/public/payment-callback", { body: { Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: id, ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [{ Name: "Amount", Value: 2000 }, { Name: "MpesaReceiptNumber", Value: receipt }] } } } } });

    const late = await mk(`late_${suffix}_a`);
    const r1 = `LAT${randomBytes(3).toString("hex").toUpperCase()}`;
    await cb(`late_${suffix}_a`, r1);
    expect(await prisma.shopOrder.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID", cancelReason: null });
    expect(await prisma.payment.count({ where: { shopOrderId: late.id } })).toBe(1);
    expect(await stockOf(p.id)).toBe(1); // the two bought are off the shelf again

    // Not enough left any more: the money is parked for a refund, the order stays closed, nothing is oversold.
    const tooLate = await mk(`late_${suffix}_b`);
    const r2 = `LAT${randomBytes(3).toString("hex").toUpperCase()}`;
    await cb(`late_${suffix}_b`, r2);
    expect(await prisma.shopOrder.findUniqueOrThrow({ where: { id: tooLate.id } })).toMatchObject({ status: "CANCELLED", paymentStatus: "FAILED" });
    expect(await prisma.pendingPayment.count({ where: { mpesaReceipt: r2 } })).toBe(1);
    expect(await stockOf(p.id)).toBe(1);
  });

  it("texts the customer at every step, and tells the owners and managers when an order is delivered or cancelled", async () => {
    const p = await product({ quantity: 5 });
    const placed = await call("POST", "/public/shop/checkout", { body: checkoutBody([{ id: p.id, qty: 1 }], { phone: P(40) }) });
    const order = await prisma.shopOrder.findUniqueOrThrow({ where: { token: placed.json().token } });
    const label = `WO-${1000 + order.orderNo}`;
    const since = new Date();
    const sent = async (key: string) => (await prisma.notificationLog.findMany({ where: { templateKey: key, createdAt: { gte: since }, payload: { path: ["message"], string_contains: label } } })).map((n) => n.recipient);
    const ownerPhone = (await prisma.staff.findFirstOrThrow({ where: { branchId, role: "OWNER" } })).phone;
    const recepPhone = (await prisma.staff.findFirstOrThrow({ where: { branchId, role: "RECEPTIONIST" } })).phone;

    await call("POST", `/shop/orders/${order.id}/mark-paid`, { cookie: receptionCookie, body: { method: "CASH" } });
    await call("PATCH", `/shop/orders/${order.id}/status`, { cookie: receptionCookie, body: { status: "READY" } });
    await call("PATCH", `/shop/orders/${order.id}/status`, { cookie: receptionCookie, body: { status: "COMPLETED" } });
    await new Promise((r) => setTimeout(r, 400)); // alerts are sent in the background

    const customer = await sent("order_status");
    expect(customer).toHaveLength(2); // "on its way" and "complete", both to the customer
    expect(new Set(customer)).toEqual(new Set([order.phone]));
    const staffAlerts = await sent("order_alert");
    expect(staffAlerts).toContain(ownerPhone); // the owner is told it was delivered
    expect(staffAlerts).not.toContain(recepPhone); // the person who did it is not
  });
});

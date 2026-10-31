/**
 * Two sides of one business (lashes, hair and wigs): separate catalogues and customers, staff locked to their
 * own side, and only people allowed to span branches can switch.
 * Run with TEST_DATABASE_URL set (see booking-flow.test.ts).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("branches (integration)", () => {
  let app: Awaited<ReturnType<typeof import("../app").buildApp>>;
  let prisma: typeof import("../config/db").prisma;
  const suffix = Math.random().toString(36).slice(2, 8);
  const lashes = `lashes-${suffix}`;
  const hair = `hair-${suffix}`;
  let lashId = "";
  let hairId = "";
  const cookies: Record<string, string> = {};

  const call = (method: string, path: string, opts: { body?: unknown; cookie?: string; query?: Record<string, string>; branch?: string } = {}) =>
    app.inject({
      method: method as "GET",
      url: `/api/v1${path}`,
      ...(opts.query ? { query: opts.query } : {}),
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.branch ? { "x-branch-id": opts.branch } : {}) },
    });

  const login = async (email: string) => {
    const res = await call("POST", "/auth/login", { body: { email, password: "Password123!" } });
    expect(res.statusCode).toBe(200);
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
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
    lashId = (await prisma.branch.create({ data: { name: "Lashes Side", slug: lashes, sortOrder: 0, settings: { create: {} } } })).id;
    hairId = (await prisma.branch.create({ data: { name: "Hair & Wigs Side", slug: hair, sortOrder: 1, settings: { create: {} } } })).id;

    const phone = () => `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`;
    const mk = (key: string, branchId: string, role: "OWNER" | "MANAGER" | "RECEPTIONIST", span = false) =>
      prisma.staff.create({ data: { branchId, name: key, email: `${key.toLowerCase()}-${suffix}@test.local`, phone: phone(), passwordHash, role, isBookable: false, canSwitchBranches: span } });
    await mk("ownerAll", lashId, "OWNER", true); // overseeing both
    await mk("ownerHair", hairId, "OWNER", false); // restricted to hair & wigs
    await mk("mgrLash", lashId, "MANAGER");
    await mk("mgrHair", hairId, "MANAGER");
    await mk("recLash", lashId, "RECEPTIONIST");
    for (const k of ["ownerAll", "ownerHair", "mgrLash", "mgrHair", "recLash"]) cookies[k] = await login(`${k.toLowerCase()}-${suffix}@test.local`);

    await prisma.service.create({ data: { branchId: lashId, name: `Classic Lashes ${suffix}`, durationMin: 60, price: 3000 } });
    await prisma.service.create({ data: { branchId: hairId, name: `Wig Install ${suffix}`, durationMin: 90, price: 2500 } });
    await prisma.stockItem.create({ data: { branchId: hairId, name: `Bob Wig ${suffix}`, costPrice: 1000, salePrice: 3500, quantity: 3, isPublished: true } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("shows each side its own services and products, and defaults to the first branch", async () => {
    const names = async (q: Record<string, string>) => ((await call("GET", "/public/services", { query: q })).json() as Array<{ name: string }>).map((s) => s.name);
    expect(await names({ branch: lashes })).toEqual([`Classic Lashes ${suffix}`]);
    expect(await names({ branch: hair })).toEqual([`Wig Install ${suffix}`]);
    expect(await names({})).toEqual([`Classic Lashes ${suffix}`]); // first by order

    const shop = async (q: Record<string, string>) => ((await call("GET", "/public/shop/products", { query: q })).json() as { products: Array<{ name: string }> }).products.map((p) => p.name);
    expect(await shop({ branch: lashes })).toEqual([]);
    expect(await shop({ branch: hair })).toEqual([`Bob Wig ${suffix}`]);
  });

  it("tells the website which sides exist and which one it is showing", async () => {
    const l = (await call("GET", "/public/landing", { query: { branch: hair } })).json();
    expect(l.branch).toBe(hair);
    expect(l.salon.name).toBe("Hair & Wigs Side");
    expect(l.branches.map((b: { slug: string }) => b.slug)).toEqual([lashes, hair]);
    expect((await call("GET", "/public/landing", { query: { branch: "no-such-side" } })).statusCode).toBe(404);
  });

  it("does not let a shop order mix branches", async () => {
    const p = await prisma.stockItem.findFirstOrThrow({ where: { branchId: hairId } });
    const body = { items: [{ id: p.id, qty: 1 }], name: "Cross Shopper", phone: "0712345678", fulfilment: "PICKUP", payMethod: "ON_DELIVERY" };
    // Asking the lashes side for a hair-side product finds nothing.
    expect((await call("POST", "/public/shop/checkout", { body, query: { branch: lashes } })).statusCode).toBe(409);
    const ok = await call("POST", "/public/shop/checkout", { body, query: { branch: hair } });
    expect(ok.statusCode).toBe(201);
    expect((await prisma.shopOrder.findFirstOrThrow({ where: { token: ok.json().token } })).branchId).toBe(hairId);
  });

  it("keeps a customer who uses both sides as a separate customer on each", async () => {
    const digits = String(Math.floor(Math.random() * 9e5 + 1e5));
    const phone = `0733${digits}`;
    const intl = `+254733${digits}`;
    for (const [branchSlug, svc] of [[lashes, "Classic Lashes"], [hair, "Wig Install"]] as const) {
      const service = await prisma.service.findFirstOrThrow({ where: { name: { startsWith: svc }, branch: { slug: branchSlug } } });
      const { findOrCreateClient } = await import("../features/booking/booking.service");
      await findOrCreateClient(prisma, service.branchId, { phone, name: "Both Sides" });
    }
    expect(await prisma.client.count({ where: { phone: intl } })).toBe(2);
    expect(await prisma.client.count({ where: { phone: intl, branchId: lashId } })).toBe(1);
  });

  it("locks staff to their own branch, even if they ask for another", async () => {
    // A lashes manager sees lashes services; asking for the hair branch is refused.
    const svc = async (cookie: string, branch?: string) => call("GET", "/services", { cookie, ...(branch ? { branch } : {}) });
    expect(((await svc(cookies.mgrLash!)).json() as Array<{ name: string }>).map((s) => s.name)).toEqual([`Classic Lashes ${suffix}`]);
    expect((await svc(cookies.mgrLash!, hairId)).statusCode).toBe(403);
    expect((await svc(cookies.recLash!, hairId)).statusCode).toBe(403);
    // A restricted owner (not allowed to span branches) is locked in too.
    expect((await svc(cookies.ownerHair!, lashId)).statusCode).toBe(403);
    expect(((await svc(cookies.ownerHair!)).json() as Array<{ name: string }>).map((s) => s.name)).toEqual([`Wig Install ${suffix}`]);
  });

  it("lets an owner who spans branches work on either side, and refuses unknown branches", async () => {
    const svc = async (branch?: string) => call("GET", "/services", { cookie: cookies.ownerAll!, ...(branch ? { branch } : {}) });
    expect(((await svc()).json() as Array<{ name: string }>).map((s) => s.name)).toEqual([`Classic Lashes ${suffix}`]);
    expect(((await svc(hairId)).json() as Array<{ name: string }>).map((s) => s.name)).toEqual([`Wig Install ${suffix}`]);
    expect((await svc("does-not-exist")).statusCode).toBe(404);

    // Work done while on the hair side lands on the hair side.
    const created = await call("POST", "/services", { cookie: cookies.ownerAll!, branch: hairId, body: { name: `Silk Press ${suffix}`, durationMin: 60, price: 2000 } });
    expect(created.statusCode).toBe(201);
    expect((await prisma.service.findUniqueOrThrow({ where: { id: created.json().id } })).branchId).toBe(hairId);
    // A forged branchId in the body cannot move it elsewhere.
    const forged = await call("POST", "/services", { cookie: cookies.mgrLash!, body: { name: `Forged ${suffix}`, durationMin: 60, price: 1000, branchId: hairId } });
    expect((await prisma.service.findUniqueOrThrow({ where: { id: forged.json().id } })).branchId).toBe(lashId);
  });

  it("lists only the branches a person may use, and only the all-branches owner manages them", async () => {
    const list = async (k: string) => (await call("GET", "/branches", { cookie: cookies[k]! })).json() as { canSwitch: boolean; branches: Array<{ slug: string }> };
    expect((await list("mgrLash")).branches.map((b) => b.slug)).toEqual([lashes]);
    expect((await list("ownerAll")).branches.map((b) => b.slug)).toEqual(expect.arrayContaining([lashes, hair]));
    expect((await list("ownerAll")).canSwitch).toBe(true);

    expect((await call("POST", "/branches", { cookie: cookies.ownerHair!, body: { name: "Sneaky" } })).statusCode).toBe(403);
    const made = await call("POST", "/branches", { cookie: cookies.ownerAll!, body: { name: `Nakuru Branch ${suffix}` } });
    expect(made.statusCode).toBe(201);
    expect(made.json().slug).toMatch(/^nakuru-branch-/);
    expect((await call("POST", "/branches", { cookie: cookies.ownerAll!, body: { name: "Dup", slug: lashes } })).statusCode).toBe(409);
    expect((await call("PATCH", `/branches/${lashId}`, { cookie: cookies.ownerAll!, body: { isActive: false } })).statusCode).toBe(400); // own branch
    expect((await call("PATCH", `/branches/${made.json().id}`, { cookie: cookies.ownerAll!, body: { isActive: false } })).statusCode).toBe(200);
  });

  it("only an owner who spans branches can let others work across branches", async () => {
    const mgr = await prisma.staff.findFirstOrThrow({ where: { email: `mgrhair-${suffix}@test.local` } });
    expect((await call("PATCH", `/staff/${mgr.id}`, { cookie: cookies.ownerHair!, body: { canSwitchBranches: true } })).statusCode).toBe(403);
    const ok = await call("PATCH", `/staff/${mgr.id}`, { cookie: cookies.ownerAll!, branch: hairId, body: { canSwitchBranches: true } });
    expect(ok.statusCode).toBe(200);
    // That manager can now look at the other side.
    const fresh = cookies.mgrHair!; // the permission is read fresh on every request, no new login needed
    expect((await call("GET", "/services", { cookie: fresh, branch: lashId })).statusCode).toBe(200);
    // A new owner for one side, created by the all-branches owner.
    const created = await call("POST", "/staff", { cookie: cookies.ownerAll!, branch: hairId, body: { name: "Second Owner", email: `own2-${suffix}@test.local`, phone: `07${Math.floor(Math.random() * 9e7 + 1e7)}`, role: "OWNER", isBookable: false, password: randomBytes(5).toString("hex") + "Aa1!" } });
    expect(created.statusCode).toBe(201);
    expect((await prisma.staff.findUniqueOrThrow({ where: { email: `own2-${suffix}@test.local` } })).branchId).toBe(hairId);
  });

  it("carries a customer's allergy notes to a new branch, and copies a menu to set one up", async () => {
    const { findOrCreateClient } = await import("../features/booking/booking.service");
    const digits = String(Math.floor(Math.random() * 9e5 + 1e5));
    const phone = `0744${digits}`;
    await findOrCreateClient(prisma, lashId, { phone, name: "Allergic Anna", allergies: "Latex glue" });
    const atHair = await findOrCreateClient(prisma, hairId, { phone, name: "Allergic Anna" });
    expect(atHair.allergies).toBe("Latex glue");
    expect(atHair.isFirstLash).toBe(false);

    const fresh = await call("POST", "/branches", { cookie: cookies.ownerAll!, body: { name: `Mombasa Salon ${suffix}`, city: "Mombasa", slug: `msa-${suffix}` } });
    expect(fresh.json().city).toBe("Mombasa");
    const id = fresh.json().id as string;
    expect((await call("POST", `/branches/${id}/copy-from`, { cookie: cookies.ownerHair!, body: { fromId: lashId } })).statusCode).toBe(403);
    const first = await call("POST", `/branches/${id}/copy-from`, { cookie: cookies.ownerAll!, body: { fromId: hairId, products: true } });
    expect(first.json()).toMatchObject({ services: expect.any(Number), products: 1 });
    const copied = await prisma.stockItem.findFirstOrThrow({ where: { branchId: id } });
    expect(copied).toMatchObject({ quantity: 0, isPublished: false }); // stock is counted by the branch itself
    expect((await call("POST", `/branches/${id}/copy-from`, { cookie: cookies.ownerAll!, body: { fromId: hairId, products: true } })).json()).toMatchObject({ services: 0, products: 0 }); // safe to repeat
  });

  it("shows the owner every branch side by side and the whole team grouped by branch", async () => {
    expect((await call("GET", "/branches/overview", { cookie: cookies.mgrLash! })).statusCode).toBe(403);
    expect((await call("GET", "/branches/overview", { cookie: cookies.ownerHair! })).statusCode).toBe(403);
    const o = (await call("GET", "/branches/overview", { cookie: cookies.ownerAll! })).json();
    expect(o.rows.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(["Lashes Side", "Hair & Wigs Side"]));
    expect(o.rows[0]).toHaveProperty("revenueMonth");

    expect((await call("GET", "/staff", { cookie: cookies.mgrLash!, query: { all: "1" } })).statusCode).toBe(403);
    const team = (await call("GET", "/staff", { cookie: cookies.ownerAll!, query: { all: "1" } })).json() as Array<{ branchId: string; branchName: string }>;
    expect(new Set(team.map((s) => s.branchId))).toEqual(expect.objectContaining({}));
    expect(team.some((s) => s.branchId === lashId)).toBe(true);
    expect(team.some((s) => s.branchId === hairId)).toBe(true);
    expect(team.every((s) => typeof s.branchName === "string")).toBe(true);
  });

  it("describes each branch to customers choosing where to go", async () => {
    await prisma.branch.update({ where: { id: hairId }, data: { city: "Kisumu", address: "Oginga Odinga St", phone: "0700111222" } });
    const l = (await call("GET", "/public/landing")).json();
    const kisumu = l.branches.find((b: { slug: string }) => b.slug === hair);
    expect(kisumu).toMatchObject({ city: "Kisumu", address: "Oginga Odinga St", phone: "0700111222" });
  });

  it("gives the booking page a light list of branches to choose from, and which one is selected", async () => {
    const r = (await call("GET", "/public/branches", { query: { branch: hair } })).json();
    expect(r.current).toBe(hair);
    expect(r.branches.map((b: { slug: string }) => b.slug)).toEqual(expect.arrayContaining([lashes, hair]));
    expect((await call("GET", "/public/branches")).json().current).toBe(lashes); // nothing chosen: the first branch
  });
});

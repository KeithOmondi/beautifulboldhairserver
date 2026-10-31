/**
 * Who may do what. Tries the actions each role must NOT be able to do, as well as the ones they must.
 * Run with TEST_DATABASE_URL set (see booking-flow.test.ts).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("permissions (integration)", () => {
  let app: Awaited<ReturnType<typeof import("../app").buildApp>>;
  let prisma: typeof import("../config/db").prisma;
  const suffix = Math.random().toString(36).slice(2, 8);
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let branchId = "";
  let otherBranchId = "";
  let paymentId = "";

  const call = (method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) =>
    app.inject({
      method: method as "GET",
      url: `/api/v1${path}`,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    });
  const login = async (email: string) => {
    const res = await call("POST", "/auth/login", { body: { email, password: "Password123!" } });
    expect(res.statusCode).toBe(200);
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  };
  const newPhone = () => `07${Math.floor(Math.random() * 9e7 + 1e7)}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET = "integration-test-secret-integration-test-secret";
    process.env.NODE_ENV = "test";
    for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL", "MPESA_CALLBACK_SECRET", "BREVO_API_KEY", "SMS_PROVIDER_API_KEY", "SMS_USERNAME", "TALKSASA_API_TOKEN", "TALKSASA_SENDER_ID", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) process.env[key] = "";
    ({ prisma } = await import("../config/db"));
    const { hashPassword } = await import("../utils/password");
    const { buildApp } = await import("../app");
    app = await buildApp();

    const passwordHash = await hashPassword("Password123!");
    await prisma.branch.updateMany({ data: { isActive: false } });
    branchId = (await prisma.branch.create({ data: { name: `Perm ${suffix}`, settings: { create: {} } } })).id;
    const mk = async (key: string, role: "OWNER" | "MANAGER" | "RECEPTIONIST" | "WORKER", extra: Record<string, unknown> = {}, signIn = true) => {
      const s = await prisma.staff.create({ data: { branchId, name: key, email: `${key}-${suffix}@test.local`, phone: `+2547${Math.floor(Math.random() * 9e7 + 1e7)}`, passwordHash, role, isBookable: false, monthlySalary: 30000, commissionPct: 1000, ...extra } });
      ids[key] = s.id;
      if (signIn) cookies[key] = await login(`${key}-${suffix}@test.local`);
    };
    await mk("owner", "OWNER");
    await mk("mgr", "MANAGER");
    await mk("mgr2", "MANAGER", {}, false); // only ever a target, so no sign-in (the login route is rate limited)
    await mk("rec", "RECEPTIONIST");
    await mk("sty", "WORKER");

    // A second branch, and an owner who looks after both.
    otherBranchId = (await prisma.branch.create({ data: { name: `Other ${suffix}`, settings: { create: {} } } })).id;
    await mk("boss", "OWNER", { canSwitchBranches: true });
    await prisma.payment.create({ data: { branchId: otherBranchId, amount: 700, method: "CASH", kind: "BALANCE" } });

    paymentId =(await prisma.payment.create({ data: { branchId, amount: 1000, method: "CASH", kind: "BALANCE" } })).id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("only the owner can see payroll and the all-payments ledger", async () => {
    for (const who of ["mgr", "rec", "sty"]) {
      expect((await call("GET", "/payroll/runs", { cookie: cookies[who]! })).statusCode).toBe(403);
      expect((await call("GET", "/ledger", { cookie: cookies[who]! })).statusCode).toBe(403);
    }
    expect((await call("GET", "/payroll/runs", { cookie: cookies.owner! })).statusCode).toBe(200);
  });

  it("a receptionist can never refund, and a manager cannot until the owner allows it", async () => {
    expect((await call("POST", `/payments/${paymentId}/refund`, { cookie: cookies.rec! })).statusCode).toBe(403);
    expect((await call("POST", `/payments/${paymentId}/refund`, { cookie: cookies.sty! })).statusCode).toBe(403);
    expect((await call("POST", `/payments/${paymentId}/refund`, { cookie: cookies.mgr! })).statusCode).toBe(403);

    // The owner trusts managers with it.
    expect((await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrRefunds: true } })).statusCode).toBe(200);
    expect((await call("GET", "/settings/access", { cookie: cookies.mgr! })).json().refunds).toBe(true);
    expect((await call("POST", `/payments/${paymentId}/refund`, { cookie: cookies.rec! })).statusCode).toBe(403); // still never the front desk
    expect((await call("POST", `/payments/${paymentId}/refund`, { cookie: cookies.mgr! })).statusCode).toBe(200);
    await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrRefunds: false } });
  });

  it("a manager cannot give themselves more access", async () => {
    expect((await call("PATCH", "/settings", { cookie: cookies.mgr!, body: { mgrRefunds: true } })).statusCode).toBe(403);
    expect((await call("PATCH", "/settings", { cookie: cookies.mgr!, body: { mgrStaffPay: true } })).statusCode).toBe(403);
    expect((await call("GET", "/settings/access", { cookie: cookies.mgr! })).json()).toMatchObject({ refunds: false, staffPay: false });
    // Ordinary settings are still theirs to change.
    expect((await call("PATCH", "/settings", { cookie: cookies.mgr!, body: { bufferMinutes: 10 } })).statusCode).toBe(200);
  });

  it("reports and the cash-up approval can be switched off for managers", async () => {
    expect((await call("GET", "/dashboard", { cookie: cookies.mgr! })).statusCode).toBe(200);
    await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrReports: false, mgrCashUp: false } });
    expect((await call("GET", "/dashboard", { cookie: cookies.mgr! })).statusCode).toBe(403);
    expect((await call("GET", "/analytics", { cookie: cookies.mgr! })).statusCode).toBe(403);
    expect((await call("POST", "/cash-up/someid/approve", { cookie: cookies.mgr! })).statusCode).toBe(403);
    expect((await call("GET", "/dashboard", { cookie: cookies.owner! })).statusCode).toBe(200);
    await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrReports: true, mgrCashUp: true } });
  });

  it("a manager looks after front-desk staff and stylists only, never other managers or owners", async () => {
    const asMgr = (path: string, body?: unknown, method = "POST") => call(method, path, { cookie: cookies.mgr!, body });
    // Cannot create a manager or an owner (no promoting a friend, or yourself by proxy).
    for (const role of ["MANAGER", "OWNER"]) {
      expect((await asMgr("/staff", { name: "Sneaky", email: `s-${role}-${suffix}@test.local`, phone: newPhone(), role })).statusCode).toBe(403);
    }
    // Cannot touch a peer manager or the owner.
    for (const target of ["mgr2", "owner"]) {
      expect((await asMgr(`/staff/${ids[target]}/reset-password`)).statusCode).toBe(403);
      expect((await asMgr(`/staff/${ids[target]}`, { name: "Hacked" }, "PATCH")).statusCode).toBe(403);
      expect((await asMgr(`/staff/${ids[target]}`, undefined, "DELETE")).statusCode).toBe(403);
    }
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: ids.mgr2! } })).name).toBe("mgr2");
    // Cannot promote a stylist to manager.
    expect((await asMgr(`/staff/${ids.sty}`, { role: "MANAGER" }, "PATCH")).statusCode).toBe(403);
    // Can do the normal job.
    expect((await asMgr("/staff", { name: "New Receptionist", email: `nr-${suffix}@test.local`, phone: newPhone(), role: "RECEPTIONIST", password: `${randomBytes(4).toString("hex")}Aa1!` })).statusCode).toBe(201);
    expect((await asMgr(`/staff/${ids.sty}`, { title: "Senior stylist" }, "PATCH")).statusCode).toBe(200);
  });

  it("pay is hidden from managers (and cannot be changed by them) until the owner allows it", async () => {
    const team = async (who: string) => (await call("GET", "/staff", { cookie: cookies[who]! })).json() as Array<Record<string, unknown>>;
    expect(JSON.stringify(await team("mgr"))).not.toMatch(/monthlySalary|commissionPct|payType/);
    expect(JSON.stringify(await team("rec"))).not.toMatch(/monthlySalary|commissionPct|payType|phone/);
    expect(JSON.stringify(await team("sty"))).not.toMatch(/monthlySalary|commissionPct|payType/);
    expect((await team("owner")).some((s) => s.monthlySalary === 30000)).toBe(true);

    // A manager editing a stylist cannot change their pay.
    await call("PATCH", `/staff/${ids.sty}`, { cookie: cookies.mgr!, body: { monthlySalary: 999999, commissionPct: 9999 } });
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: ids.sty! } })).toMatchObject({ monthlySalary: 30000, commissionPct: 1000 });

    // With the owner's permission they can see and change it.
    await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrStaffPay: true } });
    expect((await team("mgr")).some((s) => s.monthlySalary === 30000)).toBe(true);
    await call("PATCH", `/staff/${ids.sty}`, { cookie: cookies.mgr!, body: { monthlySalary: 31000 } });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: ids.sty! } })).monthlySalary).toBe(31000);
    await call("PATCH", "/settings", { cookie: cookies.owner!, body: { mgrStaffPay: false } });
  });

  it("only an owner who manages all branches can place or move staff in another branch", async () => {
    const body = (extra: object) => ({ name: "Branch Hire", email: `bh-${Math.random().toString(36).slice(2, 8)}@test.local`, phone: newPhone(), role: "RECEPTIONIST", ...extra });
    // A manager, and an owner locked to one branch, cannot reach into another.
    for (const who of ["mgr", "owner"]) {
      expect((await call("POST", "/staff", { cookie: cookies[who]!, body: body({ staffBranchId: otherBranchId }) })).statusCode).toBe(403);
    }
    // The all-branches owner picks the branch, and the person lands there.
    const made = await call("POST", "/staff", { cookie: cookies.boss!, body: body({ staffBranchId: otherBranchId }) });
    expect(made.statusCode).toBe(201);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: made.json().id } })).branchId).toBe(otherBranchId);
    // Without a choice they join the branch being worked on.
    const here = await call("POST", "/staff", { cookie: cookies.boss!, body: body({}) });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: here.json().id } })).branchId).toBe(branchId);
    // An unknown branch is refused, and a manager cannot move anyone.
    expect((await call("POST", "/staff", { cookie: cookies.boss!, body: body({ staffBranchId: "nope" }) })).statusCode).toBe(404);
    expect((await call("PATCH", `/staff/${ids.sty}`, { cookie: cookies.mgr!, body: { staffBranchId: otherBranchId } })).statusCode).toBe(403);
    // Moving works for the all-branches owner and detaches the old branch's services.
    expect((await call("PATCH", `/staff/${ids.sty}`, { cookie: cookies.boss!, body: { staffBranchId: otherBranchId } })).statusCode).toBe(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: ids.sty! } })).branchId).toBe(otherBranchId);
    await prisma.staff.update({ where: { id: ids.sty! }, data: { branchId } });
  });

  it("each branch counts its own payments, and only the all-branches owner can add them together", async () => {
    const total = async (who: string, qs = "") => (await call("GET", `/ledger?from=2000-01-01${qs}`, { cookie: cookies[who]! })).json();
    // A manager cannot read the payments ledger at all, and cannot step into another branch.
    expect((await call("GET", "/ledger", { cookie: cookies.mgr! })).statusCode).toBe(403);
    const sneaky = await app.inject({ method: "GET", url: "/api/v1/dashboard", headers: { cookie: cookies.mgr!, "x-branch-id": otherBranchId } });
    expect(sneaky.statusCode).toBe(403);
    // An owner locked to one branch sees only that branch, even if they ask for everything.
    const mine = await total("owner", "&all=1");
    expect(mine.rows.every((r: { branchName: string }) => r.branchName.startsWith("Perm"))).toBe(true);
    expect(mine.byBranch).toEqual([]);
    // The all-branches owner sees both side by side, or one at a time.
    const everything = await total("boss", "&all=1");
    expect(everything.byBranch.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([branchId, otherBranchId]));
    expect(everything.byBranch.find((b: { id: string }) => b.id === otherBranchId).net).toBe(700);
    expect((await total("boss")).rows.every((r: { branchName: string }) => r.branchName.startsWith("Perm"))).toBe(true);
  });

  it("only the front desk's own jobs stay open to the receptionist", async () => {
    expect((await call("GET", "/clients", { cookie: cookies.rec! })).statusCode).toBe(200);
    for (const path of ["/dashboard", "/analytics", "/expenses", "/branches/overview"]) {
      expect((await call("GET", path, { cookie: cookies.rec! })).statusCode).toBe(403);
    }
    expect((await call("POST", "/staff", { cookie: cookies.rec!, body: { name: "x", email: `x-${suffix}@test.local`, phone: newPhone(), role: "WORKER" } })).statusCode).toBe(403);
  });
});

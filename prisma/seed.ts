/**
 * Seed script.
 *
 *   npm run seed            Bootstrap a fresh install: salon + owner account. Safe to re-run.
 *   npm run seed:demo       Bootstrap + sample staff, services, clients and bookings for demos.
 *   npm run seed:demo -- --reset   Wipe ALL data first (refused when NODE_ENV=production).
 *
 * Owner credentials come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD / SEED_OWNER_PHONE / SEED_BUSINESS_NAME.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/config/db";
import { hashPassword } from "../src/utils/password";
import { normalizePhone } from "../src/utils/phone";
import { addDays, atMinutes, todayString } from "../src/utils/time";

const args = new Set(process.argv.slice(2));
const demo = args.has("--demo");
const reset = args.has("--reset");

const weekdays = (start: string, end: string, days: number[]) =>
  Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), days.includes(d) ? { start, end } : null]));

async function wipe() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to --reset a production database");
  console.log("Wiping existing data...");
  // Audit rows are append-only by trigger; truncate bypasses row triggers.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog","PayrollAdjustment","PayrollLine","PayrollRun","CashUp","Payment","PendingPayment","SlotHold","Booking","TimeOff","Break","Shift","ServiceCommissionOverride","StockMovement","SaleItem","ProductSale","StockItem","Expense","Feedback","LoyaltyPoint","ConsentRecord","ClientPhoto","Client","Service","Staff","BookingSettings","OtpCode","NotificationLog","Branch" RESTART IDENTITY CASCADE',
  );
}

async function main() {
  if (reset) await wipe();

  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").toLowerCase();
  const ownerPhone = normalizePhone(process.env.SEED_OWNER_PHONE ?? "0700000000");
  if (!ownerPhone) throw new Error("SEED_OWNER_PHONE is not a valid Kenyan number");
  const businessName = process.env.SEED_BUSINESS_NAME ?? "Beautifully Bold Hair";

  let branch = await prisma.branch.findFirst({ orderBy: { createdAt: "asc" } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: businessName,
        slug: "main",
        settings: {
          create: { minNoticeHours: 3, maxAheadDays: 60, bufferMinutes: 15, cancelWindowHours: 24, depositRequired: true, depositAmount: 500, maxBookingsPerDay: 2 },
        },
      },
    });
    console.log(`Created salon "${branch.name}"`);
  }

  let ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const existingOwner = await prisma.staff.findUnique({ where: { email: ownerEmail } });
  if (!existingOwner) {
    const generated = !ownerPassword;
    ownerPassword ??= randomBytes(9).toString("base64url");
    await prisma.staff.create({
      data: {
        branchId: branch.id,
        name: "Owner",
        email: ownerEmail,
        phone: ownerPhone,
        passwordHash: await hashPassword(ownerPassword),
        role: "OWNER",
        canSwitchBranches: true,
        isBookable: false,
        mustChangePassword: generated,
      },
    });
    console.log(`Created owner account: ${ownerEmail}${generated ? `  (temporary password: ${ownerPassword})` : ""}`);
  } else {
    console.log(`Owner ${ownerEmail} already exists - left unchanged`);
  }

  if (!demo) return;

  console.log("Adding demo data...");
  const demoPassword = await hashPassword("Password123!");
  // Reuse a person who already matches by email OR phone (e.g. left over from an older seed).
  const ensureStaff = async (data: { name: string; email: string; phone: string; role: 'WORKER' | 'RECEPTIONIST'; title?: string; weeklyHours?: ReturnType<typeof weekdays>; commissionPct?: number; monthlySalary?: number; bookable: boolean }) => {
    const phone = normalizePhone(data.phone)!;
    const found = await prisma.staff.findFirst({ where: { OR: [{ email: data.email }, { phone }] } });
    const shared = { isBookable: data.bookable, title: data.title ?? null, ...(data.weeklyHours ? { weeklyHours: data.weeklyHours } : {}) };
    if (found) return prisma.staff.update({ where: { id: found.id }, data: shared });
    return prisma.staff.create({
      data: {
        branchId: branch!.id, name: data.name, email: data.email, phone, passwordHash: demoPassword, role: data.role, ...shared,
        payType: data.role === 'WORKER' ? 'COMMISSION_ONLY' : 'SALARY_ONLY', commissionPct: data.commissionPct ?? null, monthlySalary: data.monthlySalary ?? null,
      },
    });
  };

  const jane = await ensureStaff({ name: 'Jane Wambui', email: 'jane@example.com', phone: '0711111111', role: 'WORKER', title: 'Lash artist', weeklyHours: weekdays('09:00', '18:00', [1, 2, 3, 4, 5, 6]), commissionPct: 1500, bookable: true });
  const amina = await ensureStaff({ name: 'Amina Hassan', email: 'amina@example.com', phone: '0722222233', role: 'WORKER', title: 'Wig specialist', weeklyHours: weekdays('10:00', '19:00', [2, 3, 4, 5, 6]), commissionPct: 2000, bookable: true });
  await ensureStaff({ name: 'Grace Akinyi', email: 'reception@example.com', phone: '0733333344', role: 'RECEPTIONIST', monthlySalary: 25000, bookable: false });

  const catalog = [
    ["Classic Lash Extensions", "Natural, lightweight lashes for everyday wear.", 90, 3500, true, false],
    ["Volume Lash Extensions", "Fuller, fluffy lashes with a dramatic finish.", 120, 4500, true, false],
    ["Lash Refill (2-3 weeks)", "Keep your set fresh between full applications.", 60, 2000, false, false],
    ["Wig Install & Style", "Frontal or closure install with a custom style.", 120, 5000, false, true],
    ["Silk Press", "Smooth, bouncy, heat-protected finish.", 90, 3000, false, false],
    ["Braids - Knotless (medium)", "Lightweight knotless braids, medium size.", 240, 6500, false, false],
  ] as const;

  const services = [];
  for (const [name, description, durationMin, price, requiresPatchTest, isWigService] of catalog) {
    const found = await prisma.service.findFirst({ where: { branchId: branch.id, name } });
    services.push(found ?? (await prisma.service.create({ data: { branchId: branch.id, name, description, durationMin, price, requiresPatchTest, isWigService, category: /lash/i.test(name) ? "Lashes" : "Hair & Wigs" } })));
  }

  // Who does what: lash work for Jane, hair work for Amina.
  const assign = async (staffId: string, ids: string[]) =>
    prisma.staffService.createMany({ data: ids.map((serviceId) => ({ staffId, serviceId })), skipDuplicates: true });
  if ((await prisma.staffService.count({ where: { staffId: { in: [jane.id, amina.id] } } })) === 0) {
    await assign(jane.id, [services[0]!.id, services[1]!.id, services[2]!.id]);
    await assign(amina.id, [services[3]!.id, services[4]!.id, services[5]!.id]);
  }

  const clientsData = [
    ["Mary Wanjiku", "0722000001", "Sensitive to latex glue"],
    ["Faith Njeri", "0722000002", null],
    ["Linet Achieng", "0722000003", null],
    ["Diana Mutheu", "0722000004", "Allergic to nickel"],
  ] as const;
  const clients = [];
  for (const [name, phone, allergies] of clientsData) {
    const normalized = normalizePhone(phone)!;
    clients.push(
      (await prisma.client.findUnique({ where: { branchId_phone: { branchId: branch.id, phone: normalized } } })) ??
        (await prisma.client.create({ data: { branchId: branch.id, name, phone: normalized, allergies, isFirstLash: false } })),
    );
  }

  if ((await prisma.booking.count()) === 0) {
    const today = todayString();
    const plan: Array<[number, string, number, number, number, "COMPLETED" | "CONFIRMED" | "NO_SHOW", boolean]> = [
      // dayOffset, start HH:mm, clientIdx, serviceIdx, staff(0 jane|1 amina), status, paid
      [-6, "10:00", 0, 0, 0, "COMPLETED", true],
      [-5, "11:00", 1, 3, 1, "COMPLETED", true],
      [-4, "14:00", 2, 4, 0, "COMPLETED", true],
      [-3, "10:30", 3, 1, 0, "COMPLETED", true],
      [-2, "12:00", 1, 2, 0, "NO_SHOW", false],
      [-1, "15:00", 0, 4, 1, "COMPLETED", true],
      [0, "09:30", 2, 2, 0, "COMPLETED", true],
      [0, "13:00", 3, 3, 1, "CONFIRMED", false],
      [0, "16:00", 1, 0, 0, "CONFIRMED", false],
      [1, "10:00", 0, 1, 0, "CONFIRMED", false],
      [2, "11:00", 2, 5, 1, "CONFIRMED", false],
    ];
    const staffArr = [jane, amina];
    for (const [offset, time, ci, si, sti, status, paid] of plan) {
      const service = services[si]!;
      const [h, m] = time.split(":").map(Number);
      const startAt = atMinutes(addDays(today, offset), h! * 60 + m!);
      const booking = await prisma.booking.create({
        data: {
          branchId: branch.id,
          clientId: clients[ci]!.id,
          staffId: staffArr[sti]!.id,
          serviceId: service.id,
          startAt,
          endAt: new Date(startAt.getTime() + service.durationMin * 60_000),
          status,
          source: ci % 2 ? "ONLINE" : "WALKIN",
          price: service.price,
          depositPaid: 500,
          paid,
          manageToken: randomBytes(24).toString("hex"),
        },
      });
      await prisma.payment.create({
        data: { branchId: branch.id, bookingId: booking.id, amount: 500, method: "MPESA", kind: "DEPOSIT", mpesaReceipt: `DEMO${randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 10), createdAt: new Date(startAt.getTime() - 3 * 86_400_000) },
      });
      if (paid) {
        await prisma.payment.create({
          data: { branchId: branch.id, bookingId: booking.id, amount: service.price - 500, method: ci % 2 ? "MPESA" : "CASH", kind: "BALANCE", ...(ci % 2 ? { mpesaReceipt: `DEMO${randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 10) } : {}), createdAt: startAt },
        });
      }
    }
    await prisma.expense.createMany({
      data: [
        { branchId: branch.id, category: "Supplies", amount: 6500, note: "Lash adhesive and trays" },
        { branchId: branch.id, category: "Rent", amount: 30000, note: "Monthly rent" },
      ],
    });
  }

  console.log("Demo data ready. Staff logins use password: Password123!  (jane@example.com, amina@example.com, reception@example.com)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

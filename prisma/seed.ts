import "dotenv/config";
import { prisma } from "../src/config/db";
import { hashPassword } from "../src/utils/password";
import { normalizePhone } from "../src/utils/phone";

async function main() {
  console.log("🌱 Starting seed...");

  // 1. Clean existing data (in reverse dependency order)
  console.log("🧹 Cleaning database...");
  await prisma.payrollAdjustment.deleteMany();
  await prisma.payrollLine.deleteMany();
  await prisma.payrollRun.deleteMany();
  await prisma.cashUp.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.timeOff.deleteMany();
  await prisma.break.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.client.deleteMany();
  await prisma.service.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.otpCode.deleteMany();

  // 2. Create the Branch
  console.log("🏢 Creating branch...");
  const branch = await prisma.branch.create({
    data: {
      name: "Nairobi CBD Salon",
      isActive: true,
      settings: {
        create: {
          minNoticeHours: 3,
          maxAheadDays: 60,
          bufferMinutes: 15,
          cancelWindowHours: 24,
          depositRequired: true,
          depositAmount: 1000,
          maxBookingsPerDay: 2,
        }
      }
    },
  });

  // 3. Create the Owner
  console.log("👑 Creating owner...");
  const ownerPassword = await hashPassword("Password123!");
  const owner = await prisma.staff.create({
    data: {
      branchId: branch.id,
      name: "Dennis (Owner)",
      email: "denniskeith62@gmail.com",
      phone: normalizePhone("0700000000")!,
      passwordHash: ownerPassword,
      role: "OWNER",
      payType: "SALARY_ONLY",
      monthlySalary: 50000,
    },
  });

  // 4. Create a Worker
  console.log("💅 Creating worker...");
  const workerPassword = await hashPassword("Password123!");
  const worker = await prisma.staff.create({
    data: {
      branchId: branch.id,
      name: "Jane (Lash Tech)",
      email: "kd.omondi1@gmail.com",
      phone: normalizePhone("0711111111")!,
      passwordHash: workerPassword,
      role: "WORKER",
      payType: "COMMISSION_ONLY",
      commissionPct: 1500, // 15%
    },
  });

  // 5. Create Services
  console.log("✨ Creating services...");
  const lashService = await prisma.service.create({
    data: {
      branchId: branch.id,
      name: "Classic Lash Extensions",
      durationMin: 90,
      price: 3500,
      requiresPatchTest: true,
      isWigService: false,
    },
  });

  const wigService = await prisma.service.create({
    data: {
      branchId: branch.id,
      name: "Wig Install & Style",
      durationMin: 120,
      price: 5000,
      requiresPatchTest: false,
      isWigService: true,
    },
  });

  // 6. Create a Client
  console.log("👩🏾 Creating client...");
  const client = await prisma.client.create({
    data: {
      branchId: branch.id,
      name: "Mary Wanjiku",
      phone: normalizePhone("0722222222")!,
      allergies: "Sensitive to latex glue",
      isFirstLash: false,
    },
  });

  // 7. Create Recurring Shifts for Jane (Mon & Wed 9am-5pm for 4 weeks)
  console.log("📅 Creating shifts...");
  const today = new Date();
  
  // Find next Monday
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7));
  nextMonday.setHours(9, 0, 0, 0);

  // Find next Wednesday
  const nextWednesday = new Date(today);
  nextWednesday.setDate(today.getDate() + ((3 + 7 - today.getDay()) % 7));
  nextWednesday.setHours(9, 0, 0, 0);

  for (let week = 0; week < 4; week++) {
    // Monday Shift
    const monStart = new Date(nextMonday);
    monStart.setDate(monStart.getDate() + (week * 7));
    const monEnd = new Date(monStart);
    monEnd.setHours(17, 0, 0, 0);

    await prisma.shift.create({
      data: {
        branchId: branch.id,
        staffId: worker.id,
        startAt: monStart,
        endAt: monEnd,
      }
    });

    // Wednesday Shift
    const wedStart = new Date(nextWednesday);
    wedStart.setDate(wedStart.getDate() + (week * 7));
    const wedEnd = new Date(wedStart);
    wedEnd.setHours(17, 0, 0, 0);

    await prisma.shift.create({
      data: {
        branchId: branch.id,
        staffId: worker.id,
        startAt: wedStart,
        endAt: wedEnd,
      }
    });
  }

  // 8. Create a Booking for Mary with Jane next Monday
  console.log("📆 Creating booking...");
  const bookingStart = new Date(nextMonday);
  bookingStart.setHours(10, 0, 0, 0);
  const bookingEnd = new Date(bookingStart);
  bookingEnd.setMinutes(bookingEnd.getMinutes() + lashService.durationMin);

  const booking = await prisma.booking.create({
    data: {
      branchId: branch.id,
      clientId: client.id,
      staffId: worker.id,
      serviceId: lashService.id,
      startAt: bookingStart,
      endAt: bookingEnd,
      status: "CONFIRMED",
      source: "WALKIN",
      price: lashService.price,
      manageToken: "demo_token_" + Date.now(),
      allergies: client.allergies,
    }
  });

  console.log("✅ Seed complete!");
  console.log("-----------------------------------------");
  console.log("Login Credentials:");
  console.log("Owner:  denniskeith62@gmail.com / Password123!");
  console.log("Worker: kd.omondi1@gmail.com  / Password123!");
  console.log("-----------------------------------------");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
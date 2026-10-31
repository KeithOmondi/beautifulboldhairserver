const fs = require("fs");
const rep = (p, pairs) => {
  let s = fs.readFileSync(p, "utf8");
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(p + ": " + a.slice(0, 70));
    s = s.replace(a, b);
  }
  fs.writeFileSync(p, s);
};

rep("prisma/schema.prisma", [[
  "  isActive          Boolean  @default(true)\n  description       String?\n  createdAt         DateTime @default(now())\n  updatedAt         DateTime @updatedAt\n\n  bookings      Booking[]\n  overrides",
  "  isActive          Boolean  @default(true)\n  description       String?\n  /// A discounted price shown crossed-out next to the normal one. Must be below price; null means no offer.\n  salePrice         Int?\n  /// Groups services on the website (e.g. \"Wigs\", \"Lashes\").\n  category          String?\n  /// A photo for the service card, chosen from the gallery.\n  imageUrl          String?\n  createdAt         DateTime @default(now())\n  updatedAt         DateTime @updatedAt\n\n  bookings      Booking[]\n  overrides",
]]);
fs.mkdirSync("prisma/migrations/20261031400000_service_offers", { recursive: true });
fs.writeFileSync("prisma/migrations/20261031400000_service_offers/migration.sql",
  'ALTER TABLE "Service" ADD COLUMN "salePrice" INTEGER, ADD COLUMN "category" TEXT, ADD COLUMN "imageUrl" TEXT;\n');

// money helper
let m = fs.readFileSync("src/utils/money.ts", "utf8");
m += `
/** What a client pays today: the offer price when one is set and genuinely lower, otherwise the normal price. */
export function currentPrice(s: { price: number; salePrice?: number | null }): number {
  return s.salePrice != null && s.salePrice >= 0 && s.salePrice < s.price ? s.salePrice : s.price;
}
`;
fs.writeFileSync("src/utils/money.ts", m);

// schema validation
rep("src/features/service/service.schema.ts", [
  ["  description: z.string().trim().max(300).optional(),\n});", "  description: z.string().trim().max(300).optional(),\n  salePrice: z.number().int().nonnegative().nullable().optional(),\n  category: z.string().trim().max(40).nullable().optional(),\n  imageUrl: z.string().url().max(500).nullable().optional(),\n});"],
  ["  description: z.string().trim().max(300).nullable().optional(),\n});", "  description: z.string().trim().max(300).nullable().optional(),\n  salePrice: z.number().int().nonnegative().nullable().optional(),\n  category: z.string().trim().max(40).nullable().optional(),\n  imageUrl: z.string().url().max(500).nullable().optional(),\n});"],
]);

// service writes
rep("src/features/service/service.service.ts", [
  [
    "  return prisma.service.create({\n    data: {",
    "  if (data.salePrice != null && data.salePrice >= data.price) throw new AppError(400, \"The offer price must be lower than the normal price\", \"BAD_REQUEST\");\n\n  return prisma.service.create({\n    data: {",
  ],
  ["      description: data.description ?? null,\n    },\n  });\n}", "      description: data.description ?? null,\n      salePrice: data.salePrice ?? null,\n      category: data.category?.trim() || null,\n      imageUrl: data.imageUrl ?? null,\n    },\n  });\n}"],
  [
    "  if (data.description !== undefined) updateData.description = data.description;\n",
    "  if (data.description !== undefined) updateData.description = data.description;\n  if (data.salePrice !== undefined) updateData.salePrice = data.salePrice;\n  if (data.category !== undefined) updateData.category = data.category?.trim() || null;\n  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;\n\n  const nextPrice = data.price ?? service.price;\n  const nextSale = data.salePrice !== undefined ? data.salePrice : service.salePrice;\n  if (nextSale != null && nextSale >= nextPrice) throw new AppError(400, \"The offer price must be lower than the normal price\", \"BAD_REQUEST\");\n",
  ],
]);

// bookings use today's price
rep("src/features/booking/booking.service.ts", [
  ["  const discount = Math.min(args.discount ?? 0, service.price);", "  const today = currentPrice(service);\n  const discount = Math.min(args.discount ?? 0, today);"],
  ["        price: service.price,", "        price: today,"],
]);
let bk = fs.readFileSync("src/features/booking/booking.service.ts", "utf8");
bk = bk.replace(/^(import [^\n]*\n)/m, '$1import { currentPrice } from "../../utils/money";\n');
fs.writeFileSync("src/features/booking/booking.service.ts", bk);

// public booking: deposit and catalogue
rep("src/features/public-booking/public-booking.service.ts", [
  ["Math.min(settings!.depositAmount, service.price)", "Math.min(settings!.depositAmount, currentPrice(service))"],
  [
    "  return prisma.service.findMany({\n    where: { branchId: branch.id, isActive: true },\n    select: { id: true, name: true, description: true, durationMin: true, price: true, requiresPatchTest: true },\n    orderBy: [{ price: \"asc\" }, { name: \"asc\" }],\n  });",
    "  const rows = await prisma.service.findMany({\n    where: { branchId: branch.id, isActive: true },\n    select: { id: true, name: true, description: true, durationMin: true, price: true, salePrice: true, category: true, imageUrl: true, requiresPatchTest: true },\n    orderBy: [{ price: \"asc\" }, { name: \"asc\" }],\n  });\n  // `price` is what the client pays today; `wasPrice` is the normal price, present only while an offer runs.\n  return rows.map(({ salePrice, ...r }) => {\n    const today = currentPrice({ price: r.price, salePrice });\n    return { ...r, price: today, wasPrice: today < r.price ? r.price : null };\n  });",
  ],
]);
let pb = fs.readFileSync("src/features/public-booking/public-booking.service.ts", "utf8");
pb = pb.replace(/^(import [^\n]*\n)/m, '$1import { currentPrice } from "../../utils/money";\n');
fs.writeFileSync("src/features/public-booking/public-booking.service.ts", pb);

// landing
rep("src/features/site/site.public.routes.ts", [
  ["      select: { id: true, name: true, description: true, durationMin: true, price: true },\n      orderBy: [{ price: \"asc\" }, { name: \"asc\" }],", "      select: { id: true, name: true, description: true, durationMin: true, price: true, salePrice: true, category: true, imageUrl: true },\n      orderBy: [{ price: \"asc\" }, { name: \"asc\" }],"],
  ["    services,\n    gallery:", "    services: services.map(({ salePrice, imageUrl, ...r }) => {\n      const today = currentPrice({ price: r.price, salePrice });\n      return { ...r, price: today, wasPrice: today < r.price ? r.price : null, image: imageUrl ? optimizedUrl(imageUrl, 640) : null };\n    }),\n    gallery:"],
]);
let sp = fs.readFileSync("src/features/site/site.public.routes.ts", "utf8");
sp = sp.replace('import { AppError } from "../../utils/errors";', 'import { AppError } from "../../utils/errors";\nimport { currentPrice } from "../../utils/money";');
fs.writeFileSync("src/features/site/site.public.routes.ts", sp);

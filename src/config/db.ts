import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { env } from "./env";

// The pg driver doesn't understand Prisma's ?schema= parameter,
// so pull it out of the URL and pass it as an adapter option instead.
const url = new URL(env.DATABASE_URL);
const schema = url.searchParams.get("schema") ?? "public";
url.searchParams.delete("schema");

const adapter = new PrismaPg({ connectionString: url.toString() }, { schema });

export const prisma = new PrismaClient({ adapter });
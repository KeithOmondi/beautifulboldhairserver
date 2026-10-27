import { env } from "./config/env"; // must stay first: loads .env and sets TZ
import { prisma } from "./config/db";
import { buildApp } from "./app";

async function main() {
  // Fail fast: don't start listening if the database is unreachable.
  await prisma.$connect();

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
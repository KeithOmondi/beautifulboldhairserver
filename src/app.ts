import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env";
import { prisma } from "./config/db";
import { optimizedUrl } from "./integrations/cloudinary";
import { errorHandler } from "./middleware/error-handler";
import { healthRoutes } from "./routes/health.routes";
import { registerFeatures } from "./features/auth";

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === "test" && !process.env.TEST_LOGS ? false : { level: env.LOG_LEVEL },
    // Behind Render/Fly/nginx the real client IP is in X-Forwarded-For; rate limits need it.
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  const origins = [env.PUBLIC_BOOKING_BASE_URL, ...(env.CORS_ORIGINS?.split(",").map((o) => o.trim()) ?? [])];
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? origins : true,
    credentials: true,
    // The plugin's default allows only GET, HEAD and POST, which blocks every edit and delete from the dev client.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(helmet, {
    // The SPA is served from this origin and talks to /api on it.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
        // Gallery photos are uploaded by the owner's browser straight to Cloudinary.
        connectSrc: ["'self'", "https://api.cloudinary.com"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Plain-http local runs must not be force-upgraded to https.
        upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "RATE_LIMITED",
      message: `Too many requests. Please try again in ${ctx.after}.`,
    }),
  });

  await app.register(cookie);
  // `cookie` makes req.jwtVerify({ onlyCookie: true }) read the staff session cookie.
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "accessToken", signed: false },
  });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await registerFeatures(app);

  // Search engines: index the public pages only, never the staff workspace.
  const site = env.PUBLIC_BOOKING_BASE_URL.replace(/\/$/, "");
  app.get("/robots.txt", async (_req, reply) =>
    reply.type("text/plain").send(`User-agent: *\nDisallow: /app\nDisallow: /login\nDisallow: /manage\nDisallow: /api\nSitemap: ${site}/sitemap.xml\n`),
  );
  app.get("/sitemap.xml", async (_req, reply) => {
    const urls = ["/", "/book", "/contact", "/privacy", "/terms"];
    const body = urls.map((u) => `  <url><loc>${site}${u}</loc></url>`).join("\n");
    return reply.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
  });

  // Serve the built React app from the same origin: one URL, no CORS, cookies just work.
  const dist = resolve(process.cwd(), env.CLIENT_DIST);
  if (env.SERVE_CLIENT && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: false });

    // index.html is served with the salon's own name, description and photo filled into the link-preview
    // tags, because WhatsApp/Instagram/Google read those without running JavaScript.
    const template = readFileSync(resolve(dist, "index.html"), "utf8");
    let cached: { at: number; html: string } | null = null;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const renderIndex = async () => {
      if (cached && Date.now() - cached.at < 60_000) return cached.html;
      let title = "Book an appointment";
      let desc = "Book your appointment online. Instant confirmation.";
      let image = `${site}/favicon.svg`;
      try {
        const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
        if (branch) {
          title = `${branch.name} | Book online`;
          desc = branch.tagline ?? `Book your appointment at ${branch.name} online. Instant confirmation.`;
          const photo = await prisma.galleryImage.findFirst({ where: { branchId: branch.id, isPublished: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
          if (photo) image = optimizedUrl(photo.url, 1200);
        }
      } catch {
        /* the page still works with generic tags if the database is briefly unavailable */
      }
      const html = template
        .replaceAll("__OG_TITLE__", esc(title))
        .replaceAll("__OG_DESC__", esc(desc))
        .replaceAll("__OG_IMAGE__", esc(image))
        .replaceAll("__OG_URL__", esc(site));
      cached = { at: Date.now(), html };
      return html;
    };

    const sendIndex = async (_req: unknown, reply: import("fastify").FastifyReply) =>
      reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(await renderIndex());

    app.get("/", sendIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Route not found" });
      }
      return sendIndex(req, reply); // client-side routing fallback
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "NOT_FOUND", message: "Route not found" }));
  }

  return app;
}

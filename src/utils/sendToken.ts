import type { FastifyReply } from "fastify";
import type { AuthUser, RefreshTokenPayload } from "../features/auth/auth.types";

// Secure cookies need HTTPS; only demand it when the public URL is actually https.
const secure = process.env.NODE_ENV === "production" && (process.env.PUBLIC_BOOKING_BASE_URL ?? "").startsWith("https");

export function clearTokens(reply: FastifyReply) {
  reply.clearCookie("accessToken", { path: "/" });
  reply.clearCookie("refreshToken", { path: "/api/v1/auth/refresh" });
}

export function sendToken(reply: FastifyReply, user: AuthUser) {
  // 1. Create the short-lived access token (15 minutes)
  const accessToken = reply.server.jwt.sign(user, { expiresIn: "15m" });

  // 2. Create the long-lived refresh token (7 days)
  const refreshTokenPayload: RefreshTokenPayload = { sub: user.sub, type: "refresh" };
  
  // We use `as any` here because @fastify/jwt globally forces `sign()`
  // to only accept the AuthUser shape.
  const refreshToken = reply.server.jwt.sign(refreshTokenPayload as any, { expiresIn: "7d" });

  // 3. Set the Access Token cookie
  reply.setCookie("accessToken", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60, // 15 minutes in seconds
  });

  // 4. Set the Refresh Token cookie (scoped only to the refresh endpoint)
  reply.setCookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/v1/auth/refresh",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });

  // 5. Return the user so the frontend can update the Redux state
  return { user };
}
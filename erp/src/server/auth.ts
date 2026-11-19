// Cookie sessions backed by the Session table. The cookie holds a random token; the DB stores its hash.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { AppError, Ctx, audit, prisma } from "./core";
import { loadPermissions } from "./rbac";
import { assertNotThrottled, recordFailedLogin } from "./login-throttle";

export const SESSION_COOKIE = "jj_session";
const ttlHours = () => Number(process.env.SESSION_TTL_HOURS ?? 12);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Client IP. The app listens on 127.0.0.1 behind nginx and Cloudflare, so the forwarding headers are set by them:
 * Cloudflare's cf-connecting-ip first, then the first x-forwarded-for hop, then x-real-ip.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip");
  return ip?.trim().slice(0, 64) || null;
}

export async function login(rawEmail: string, password: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase().slice(0, 200);
  const ip = await clientIp();
  await assertNotThrottled(email, ip);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !ok) {
    await recordFailedLogin(email, ip, user);
    throw new AppError("UNAUTHENTICATED", "Invalid email or password");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt } });
    await tx.loginAttempt.create({ data: { email, ip, success: true } });
    await audit(tx, { userId: user.id, permissions: new Set(), ip }, { action: "login", entity: "User", entityId: user.id });
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await prisma.session.findUnique({ where: { id: hashToken(token) } });
    if (session) {
      const ip = await clientIp();
      await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { id: session.id } });
        await audit(tx, { userId: session.userId, permissions: new Set(), ip }, { action: "logout", entity: "User", entityId: session.userId });
      });
    }
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = { id: string; name: string; email: string; roleName: string; ctx: Ctx };

/** Current user for this request (memoised per request), or null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { role: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const permissions = await loadPermissions(session.userId);
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    roleName: session.user.role.name,
    ctx: { userId: session.user.id, permissions, ip: await clientIp() },
  };
});

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

/** For pages: render 403 when the permission is missing. */
export async function requirePermission(permission: string): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.ctx.permissions.has(permission)) redirect(`/forbidden?p=${encodeURIComponent(permission)}`);
  return u;
}

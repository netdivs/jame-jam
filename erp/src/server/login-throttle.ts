// Login rate limit and failed-login audit (TS-02). Kept apart from auth.ts (which is server-only and reads cookies)
// so it can be tested directly.
//  - Failed attempts are counted per email since the later of (window start, last successful sign-in), and per IP
//    over the window. Over the limit, sign-in is refused before the password is checked.
//  - Each failure is stored in LoginAttempt and audited as "loginFailed" with the email, the reason and the IP.
import { AppError, audit, prisma } from "./core";

const envInt = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isInteger(v) && v > 0 ? v : d;
};
export const LOGIN_WINDOW_MIN = 15;
export const MAX_FAILS_PER_EMAIL = envInt("LOGIN_MAX_FAILS_PER_EMAIL", 5);
/** High on purpose: behind Cloudflare a whole office shares one public IP, and an IP lock also stops correct
 *  passwords from that IP. It is there to slow password spraying across many emails, not to catch typos.
 *  The E2E server raises it, because every test sign-in comes from the same local address. */
export const MAX_FAILS_PER_IP = envInt("LOGIN_MAX_FAILS_PER_IP", 50);

export async function assertNotThrottled(email: string, ip: string | null) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60_000);
  const lastOk = await prisma.loginAttempt.findFirst({ where: { email, success: true, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
  const from = lastOk && lastOk.createdAt > since ? lastOk.createdAt : since;
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.findMany({ where: { email, success: false, createdAt: { gt: from } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ip ? prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (byEmail.length >= MAX_FAILS_PER_EMAIL || byIp >= MAX_FAILS_PER_IP) {
    const oldest = byEmail[0]?.createdAt ?? since;
    const wait = Math.max(1, Math.ceil((oldest.getTime() + LOGIN_WINDOW_MIN * 60_000 - Date.now()) / 60_000));
    throw new AppError("RATE_LIMITED", `Too many failed sign-ins. Try again in ${byIp >= MAX_FAILS_PER_IP ? LOGIN_WINDOW_MIN : wait} minute(s).`);
  }
}

/** Store and audit a failed sign-in (unknown email, inactive user or wrong password). */
export async function recordFailedLogin(email: string, ip: string | null, user: { id: string; active: boolean } | null) {
  await prisma.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { email, ip, success: false } });
    await audit(tx, { userId: null, permissions: new Set(), ip }, {
      action: "loginFailed",
      entity: "User",
      entityId: user?.id ?? null,
      meta: { email, reason: !user ? "unknown email" : !user.active ? "inactive user" : "wrong password" },
    });
  });
}

// TS-02: login rate limit, failed-login audit with IP, IP on audit rows.
import { describe, expect, it } from "vitest";
import { AppError, audit, prisma } from "../src/server/core";
import { MAX_FAILS_PER_EMAIL, MAX_FAILS_PER_IP, assertNotThrottled, recordFailedLogin } from "../src/server/login-throttle";
import { uid } from "./helpers";

async function throttled(email: string, ip: string | null) {
  return assertNotThrottled(email, ip).then(
    () => false,
    (e: unknown) => {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("RATE_LIMITED");
      return true;
    },
  );
}

describe("login rate limit (TS-02)", () => {
  it("locks an email after 5 failures; a success resets the count; failures are audited with the IP", async () => {
    const email = `nobody-${uid()}@test.local`.toLowerCase();
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
      expect(await throttled(email, "10.0.0.1")).toBe(false);
      await recordFailedLogin(email, "10.0.0.1", null);
    }
    expect(await throttled(email, "10.0.0.2")).toBe(true); // locked whatever the IP
    const logs = await prisma.auditLog.findMany({ where: { action: "loginFailed", meta: { path: ["email"], equals: email } } });
    expect(logs).toHaveLength(MAX_FAILS_PER_EMAIL);
    expect(logs[0].ip).toBe("10.0.0.1");
    expect(logs[0].meta).toMatchObject({ reason: "unknown email" });

    // A successful sign-in after the failures starts the count again.
    const email2 = `user-${uid()}@test.local`.toLowerCase();
    for (let i = 0; i < MAX_FAILS_PER_EMAIL - 1; i++) await recordFailedLogin(email2, null, null);
    await prisma.loginAttempt.create({ data: { email: email2, success: true } });
    await recordFailedLogin(email2, null, null);
    expect(await throttled(email2, null)).toBe(false);
  });

  it("locks an IP after 50 failures across emails; no IP means no IP limit", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 250) + 1}-${uid()}`;
    for (let i = 0; i < MAX_FAILS_PER_IP; i++) await recordFailedLogin(`spray-${i}-${uid()}@test.local`, ip, null);
    expect(await throttled(`fresh-${uid()}@test.local`, ip)).toBe(true);
    expect(await throttled(`fresh-${uid()}@test.local`, null)).toBe(false);
  });

  it("audit rows carry the request IP from the context", async () => {
    const id = uid();
    await prisma.$transaction((tx) => audit(tx, { userId: null, permissions: new Set(), ip: "203.0.113.9" }, { action: "test", entity: "Test", entityId: id }));
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entity: "Test", entityId: id } })).ip).toBe("203.0.113.9");
  });
});

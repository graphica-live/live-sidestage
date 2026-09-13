import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

const DESKTOP_SECRET = "desktop-test-secret-32bytes-long!!";
const MOBILE_SECRET = "mobile-test-secret-32bytes-long!!!";

beforeEach(() => {
  vi.resetModules();
  process.env.DESKTOP_JWT_SECRET = DESKTOP_SECRET;
  process.env.MOBILE_JWT_SECRET = MOBILE_SECRET;
});

afterEach(() => {
  delete process.env.DESKTOP_JWT_SECRET;
  delete process.env.MOBILE_JWT_SECRET;
});

describe("desktop JWT", () => {
  it("rejects a mobile-signed token", async () => {
    const { signDesktopToken, verifyDesktopToken } = await import("./desktop-auth");
    const { signMobileToken } = await import("./mobile-auth");

    const mobile = signMobileToken({ principalId: "p1" });
    expect(verifyDesktopToken(mobile)).toBeNull();
    const desktop = signDesktopToken({ principalId: "p1" });
    expect(verifyDesktopToken(desktop)?.principalId).toBe("p1");
    expect(jwt.decode(desktop)).toMatchObject({ aud: "desktop", principalId: "p1" });
    expect(() => jwt.verify(desktop, MOBILE_SECRET)).toThrow();
  });
});
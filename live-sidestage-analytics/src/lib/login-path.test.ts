import { describe, it, expect } from "vitest";
import { isAgencyPath, isEventPath, loginPathFor } from "./login-path";

// 未ログイン時の飛び先。middleware.test.ts は matcher(保護範囲)しか見ないので、
// 振り分けロジックそのものはここで固定する。
describe("loginPathFor", () => {
  it("イベント側はイベント専用ログインへ送る", () => {
    for (const path of [
      "/event",
      "/event/anything",
      "/events",
      "/events/abc123",
      "/events/abc123/participants",
      "/api/events",
      "/api/events/abc123/matches",
    ]) {
      expect(loginPathFor(path), path).toBe("/event/login");
    }
  });

  it("事務所は事務所ログインへ送る", () => {
    for (const path of ["/agency", "/api/agency", "/api/agency/watches/abc"]) {
      expect(loginPathFor(path), path).toBe("/agency/login");
    }
  });

  it("それ以外は analytics のログインへ送る", () => {
    for (const path of ["/analytics", "/setup", "/admin", "/", "/api/streamer/api-key"]) {
      expect(loginPathFor(path), path).toBe("/login");
    }
  });

  // 境界なしの前置一致だと `/eventual` がイベント側へ流れてしまう。
  it("前置一致ではなくパス境界で判定する", () => {
    for (const path of ["/eventual", "/eventsomething", "/agencyfoo", "/api/eventsx"]) {
      expect(loginPathFor(path), path).toBe("/login");
    }
  });
});

describe("isAgencyPath / isEventPath", () => {
  it("互いに食い合わない", () => {
    expect(isAgencyPath("/agency/watches")).toBe(true);
    expect(isEventPath("/agency/watches")).toBe(false);
    expect(isEventPath("/events/abc")).toBe(true);
    expect(isAgencyPath("/events/abc")).toBe(false);
  });
});

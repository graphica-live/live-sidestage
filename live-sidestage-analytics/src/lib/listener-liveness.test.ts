import { describe, it, expect } from "vitest";
import { resolveLiveness, activityOf, LISTENER_STALE_MS } from "./listener-liveness";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("resolveLiveness", () => {
  it("新鮮なliveは配信中として扱う", () => {
    expect(resolveLiveness("live", ago(1_000), NOW)).toEqual({ live: true, stale: false });
  });

  it("新鮮なofflineは配信開始待ち(live=false, stale=false)として扱う", () => {
    expect(resolveLiveness("offline", ago(1_000), NOW)).toEqual({ live: false, stale: false });
  });

  it("新鮮なunknownもstaleにはしない(理由はhealth側で見る)", () => {
    expect(resolveLiveness("unknown", ago(1_000), NOW)).toEqual({ live: false, stale: false });
  });

  it("listenerUpdatedAtが無ければstale扱いにする", () => {
    expect(resolveLiveness("live", null, NOW)).toEqual({ live: false, stale: true });
    expect(resolveLiveness(null, null, NOW)).toEqual({ live: false, stale: true });
  });

  it("閾値ちょうどはまだ新鮮とみなす", () => {
    expect(resolveLiveness("live", ago(LISTENER_STALE_MS), NOW)).toEqual({
      live: true,
      stale: false,
    });
  });

  it("閾値を1msでも超えたらstaleにして配信中と言わない", () => {
    expect(resolveLiveness("live", ago(LISTENER_STALE_MS + 1), NOW)).toEqual({
      live: false,
      stale: true,
    });
  });

  // Workerが落ちたまま古い状態が残ると、モバイル側はエラーが最優先なので永久に赤くなる。
  it("古い値はactivityに関わらずstaleにする", () => {
    expect(resolveLiveness("offline", ago(LISTENER_STALE_MS + 1), NOW)).toEqual({
      live: false,
      stale: true,
    });
    expect(resolveLiveness("unknown", ago(LISTENER_STALE_MS + 1), NOW)).toEqual({
      live: false,
      stale: true,
    });
  });

  // 「新しいから信用できる」と解釈すると永久にliveのままになりうる。
  it("未来の時刻はstale扱いにする", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(resolveLiveness("live", future, NOW)).toEqual({ live: false, stale: true });
  });
});

describe("activityOf", () => {
  it("新しい列があればそれを使う", () => {
    expect(activityOf({ listenerActivity: "offline", listenerStatus: "connected" })).toBe("offline");
    expect(activityOf({ listenerActivity: "live", listenerStatus: "retrying" })).toBe("live");
  });

  // 列を足す前に書かれた行、および旧Workerが書いた行。
  it("列が空ならlistenerStatusから推測する", () => {
    expect(activityOf({ listenerActivity: null, listenerStatus: "connected" })).toBe("live");
    expect(activityOf({ listenerActivity: null, listenerStatus: "retrying" })).toBe("unknown");
    expect(activityOf({ listenerActivity: null, listenerStatus: null })).toBe("unknown");
  });

  // retrying はオフラインにも障害にも使われるので offline と断定してはいけない。
  it("旧statusのretryingをofflineと決めつけない", () => {
    expect(activityOf({ listenerStatus: "retrying" })).toBe("unknown");
  });

  it("未知の値はunknownへ倒す", () => {
    expect(activityOf({ listenerActivity: "something-new" })).toBe("unknown");
  });
});

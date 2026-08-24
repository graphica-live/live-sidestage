import { describe, it, expect } from "vitest";
import {
  factsForReconnect,
  FACTS_CONNECTED,
  FACTS_CONNECTING,
  FACTS_IDLE,
  activityFromLegacyStatus,
} from "./listener-state";

describe("factsForReconnect", () => {
  // 配信していないだけ。異常ではないので health は ok のまま。
  it("配信していない場合は offline / ok", () => {
    expect(factsForReconnect("user_offline")).toMatchObject({ activity: "offline", health: "ok" });
    expect(factsForReconnect("stream_end")).toMatchObject({ activity: "offline", health: "ok" });
  });

  // これらは「こちらが繋げていない」だけで、配信しているかは分からない。
  // offline と断定すると「配信開始待ち」と表示して障害を隠す。
  it("TikTok側の障害は unknown / error にする", () => {
    expect(factsForReconnect("rate_limited")).toMatchObject({ activity: "unknown", health: "error" });
    expect(factsForReconnect("connect_failed")).toMatchObject({ activity: "unknown", health: "error" });
    expect(factsForReconnect("error")).toMatchObject({ activity: "unknown", health: "error" });
  });

  it("一時的な切断は unknown / connecting", () => {
    expect(factsForReconnect("disconnected")).toMatchObject({
      activity: "unknown",
      health: "connecting",
    });
  });

  // 新しい reason を足したときに黙って「配信中」にならない側へ倒す。
  it("未知の reason は unknown / error へ倒す", () => {
    expect(factsForReconnect("something-new")).toMatchObject({
      activity: "unknown",
      health: "error",
    });
  });

  it("レート制限のメッセージに再接続までの目安を入れる", () => {
    expect(factsForReconnect("rate_limited", 600_000).message).toContain("約10分後");
    // 待ち時間が分からないときも文章として成立させる。
    expect(factsForReconnect("rate_limited").message).not.toContain("約null");
  });

  // 以前は `再接続待機中... (connect_failed)` で、そのまま出しても何も伝わらなかった。
  it("メッセージにreasonコードを混ぜない(そのままユーザーへ出すため)", () => {
    for (const reason of ["user_offline", "stream_end", "connect_failed", "disconnected", "error"]) {
      expect(factsForReconnect(reason).message).not.toContain(reason);
      expect(factsForReconnect(reason).message.length).toBeGreaterThan(0);
    }
  });
});

describe("固定のfacts", () => {
  it("connectedだけがliveになる", () => {
    expect(FACTS_CONNECTED.activity).toBe("live");
    expect(FACTS_CONNECTING.activity).toBe("unknown");
    expect(FACTS_IDLE.activity).toBe("unknown");
  });

  it("接続中はエラー扱いにしない", () => {
    expect(FACTS_CONNECTING.health).toBe("connecting");
    expect(FACTS_IDLE.health).toBe("ok");
  });
});

describe("activityFromLegacyStatus", () => {
  it("connectedのみliveとみなす", () => {
    expect(activityFromLegacyStatus("connected")).toBe("live");
  });

  // retrying はオフライン・接続失敗・レート制限のすべてに使われるので断定できない。
  it("retryingをofflineと決めつけない", () => {
    expect(activityFromLegacyStatus("retrying")).toBe("unknown");
    expect(activityFromLegacyStatus("idle")).toBe("unknown");
    expect(activityFromLegacyStatus(null)).toBe("unknown");
  });
});

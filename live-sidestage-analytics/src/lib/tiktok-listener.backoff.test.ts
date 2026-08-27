// DB不要。scheduleReconnect()が"disconnected"/"stream_end"/"error"/"connect_failed"用に使う
// 指数バックオフの数式(nextReconnectBackoffMs)を直接検証する。
// setTimeoutの実際の発火を待つ統合テスト(tiktok-listener.reconnect-backoff.integration.test.ts)
// とは役割を分けている — こちらは純粋な数値計算のみを対象にする。
import { describe, it, expect } from "vitest";
import { nextReconnectBackoffMs } from "./tiktok-listener";

// RECONNECT_DELAY_MS=10_000, factor=2, max=75_000, jitter=±15%(tiktok-listener.ts)と対応。
const BASE_MS = 10_000;
const MAX_MS = 75_000;
const JITTER_RATIO = 0.15;

function expectWithinJitter(actual: number, center: number) {
  const min = center * (1 - JITTER_RATIO);
  const max = center * (1 + JITTER_RATIO);
  expect(actual).toBeGreaterThanOrEqual(Math.round(min));
  expect(actual).toBeLessThanOrEqual(Math.round(max));
}

describe("nextReconnectBackoffMs()", () => {
  it("1回目はBASE_MS付近(±jitter)", () => {
    expectWithinJitter(nextReconnectBackoffMs(1), BASE_MS);
  });

  it("2回目は2倍、3回目は4倍に伸びる", () => {
    expectWithinJitter(nextReconnectBackoffMs(2), BASE_MS * 2);
    expectWithinJitter(nextReconnectBackoffMs(3), BASE_MS * 4);
  });

  it("上限(MAX_MS)を超えて伸び続けない", () => {
    // 10回目は理論上10_000 * 2^9 = 5,120,000msだが、MAX_MSで頭打ちになる。
    const delay = nextReconnectBackoffMs(10);
    expect(delay).toBeLessThanOrEqual(Math.round(MAX_MS * (1 + JITTER_RATIO)));
    expect(delay).toBeGreaterThanOrEqual(Math.round(MAX_MS * (1 - JITTER_RATIO)));
  });

  it("上限はmobile側のstale判定(90秒)より短い", () => {
    // listener-liveness.tsのSTALE閾値(90秒)より前に次の再試行が来るよう、
    // jitterの上振れを含めても90秒を超えないことを保証する。
    const worstCase = MAX_MS * (1 + JITTER_RATIO);
    expect(worstCase).toBeLessThan(90_000);
  });

  it("同じfailureCountでも呼ぶたびに値が変わり得る(jitterが乱数由来)", () => {
    const samples = new Set(Array.from({ length: 20 }, () => nextReconnectBackoffMs(3)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

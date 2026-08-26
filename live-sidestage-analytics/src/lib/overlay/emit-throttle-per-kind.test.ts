import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OverlayKind } from "./kinds";

/**
 * throttle が **種類ごとに独立している**ことを固定する。
 *
 * throttle キーが `streamerId` だけだと、種類を2つ以上出したときに片方の更新が
 * もう片方を間引いてしまい、「同じ配信者の別オーバーレイだけ更新が止まる」という
 * 再現しにくい不具合になる。現状 kind は contribution 1つしかなく本物の registry では
 * 検証できないので、ここでは server-kinds を2種類に差し替えて確かめる。
 */

vi.mock("./server-kinds", () => ({
  OVERLAY_KIND_SERVER: {
    alpha: {
      snapshotEvent: "overlay:alpha:snapshot",
      buildSnapshot: vi.fn(async () => ({ kind: "alpha" })),
    },
    beta: {
      snapshotEvent: "overlay:beta:snapshot",
      buildSnapshot: vi.fn(async () => ({ kind: "beta" })),
    },
  },
}));

import { emitOverlayUpdate, __resetOverlayEmitStateForTest } from "./emit";

const emitted: { room: string; event: string }[] = [];
const g = globalThis as unknown as { __io?: unknown };

const STREAMER_ID = "streamer-xyz";
const THROTTLE_MS = 500;
const ALPHA = "alpha" as OverlayKind;
const BETA = "beta" as OverlayKind;

beforeEach(() => {
  emitted.length = 0;
  __resetOverlayEmitStateForTest();
  vi.useFakeTimers();
  g.__io = {
    to(room: string) {
      return {
        emit(event: string) {
          emitted.push({ room, event });
        },
      };
    },
  };
});

afterEach(() => {
  __resetOverlayEmitStateForTest();
  vi.useRealTimers();
  delete g.__io;
});

describe("emitOverlayUpdate の throttle", () => {
  it("同じstreamerでも種類が違えば互いを間引かない", async () => {
    await emitOverlayUpdate(STREAMER_ID, ALPHA);
    await emitOverlayUpdate(STREAMER_ID, BETA);

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);

    expect(emitted.map((e) => e.event).sort()).toEqual([
      "overlay:alpha:snapshot",
      "overlay:beta:snapshot",
    ]);
    expect(emitted.every((e) => e.room === `overlay:${STREAMER_ID}`)).toBe(true);
  });

  it("同じ種類の連打は従来どおり間引かれる", async () => {
    await emitOverlayUpdate(STREAMER_ID, ALPHA);
    await emitOverlayUpdate(STREAMER_ID, ALPHA);

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(emitted).toHaveLength(1);
  });
});

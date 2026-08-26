import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * オーバーレイ socket 送信の契約テスト。
 *
 * **OBS ブラウザソースが購読しているルーム名とイベント名を固定する。**
 * ここが変わると、配信者が OBS に設定済みのオーバーレイが無言で映らなくなる
 * (URL と違ってエラーにもならないので気づけない)。
 * `chat-feed.contract.test.ts` と同じく `global.__io` を偽装して観測する。
 *
 * 集計 (`buildOverlaySnapshot`) は prisma を引くのでモックする。ここで見たいのは
 * 中身ではなく「どこへ・どの名前で送るか」なので、集計の正しさは
 * contribution.server.integration.test.ts が別に見ている。
 */

const buildOverlaySnapshotMock = vi.hoisted(() =>
  vi.fn(async (streamerId: string) => ({ marker: "contribution-snapshot", streamerId }))
);
vi.mock("./contribution.server", () => ({ buildOverlaySnapshot: buildOverlaySnapshotMock }));

import {
  emitOverlaySnapshot,
  emitOverlayUpdate,
  overlayRoom,
  __resetOverlayEmitStateForTest,
} from "./index";

type EmittedEvent = { room: string; event: string; payload: unknown };
const emitted: EmittedEvent[] = [];
const g = globalThis as unknown as { __io?: unknown };

const STREAMER_ID = "streamer-abc";
const THROTTLE_MS = 500;

beforeEach(() => {
  emitted.length = 0;
  buildOverlaySnapshotMock.mockClear();
  __resetOverlayEmitStateForTest();
  vi.useFakeTimers();
  g.__io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
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

describe("emitOverlayUpdate", () => {
  it("overlay:{streamerId} ルームへ overlay:contribution:snapshot を送る", async () => {
    await emitOverlayUpdate(STREAMER_ID, "contribution");
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe(`overlay:${STREAMER_ID}`);
    expect(emitted[0].event).toBe("overlay:contribution:snapshot");
    expect(emitted[0].payload).toMatchObject({ marker: "contribution-snapshot", streamerId: STREAMER_ID });
  });

  it("snapshotがnull(roomId未設定など)なら送らない", async () => {
    buildOverlaySnapshotMock.mockResolvedValueOnce(null as never);

    await emitOverlayUpdate(STREAMER_ID, "contribution");
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);

    expect(emitted).toHaveLength(0);
  });

  it("連打はthrottleで間引かれ、待機中の呼び出しは1回だけ後追いする", async () => {
    // コンボギフト連打で saveGift() から何度も呼ばれる状況
    await emitOverlayUpdate(STREAMER_ID, "contribution");
    await emitOverlayUpdate(STREAMER_ID, "contribution");
    await emitOverlayUpdate(STREAMER_ID, "contribution");

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(emitted).toHaveLength(1);

    // queued が立っていた分の後追い1回
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(emitted).toHaveLength(2);

    // それ以上は増えない
    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 4);
    expect(emitted).toHaveLength(2);
  });
});

describe("emitOverlaySnapshot (legacy alias)", () => {
  // tiktok-listener.ts / api/internal/gift-event / api/streamer/overlay-settings が
  // この名前で呼び、integration テスト4本が vi.mock("./overlay") でこの名前をモックしている。
  it("emitOverlayUpdate(id, \"contribution\") と同じ送信になる", async () => {
    await emitOverlaySnapshot(STREAMER_ID);
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe(`overlay:${STREAMER_ID}`);
    expect(emitted[0].event).toBe("overlay:contribution:snapshot");
  });
});

describe("overlayRoom", () => {
  // server.js の io.use() が overlayToken を検証したあと、この名前で socket.join している
  it("server.js が join させるルーム名と一致する", () => {
    expect(overlayRoom(STREAMER_ID)).toBe(`overlay:${STREAMER_ID}`);
  });
});

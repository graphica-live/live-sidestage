import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __resetVersionStoreForTest } from "./realtime-sync/version-store";
import { __resetChatFeedStateForTest } from "./chat-feed";

// scheduleRankingSnapshotEmitは同一モジュール内のbuildRankingSnapshotを直接呼ぶため、
// chat-ranking.ts自体をvi.mockで部分差し替えしても内部呼び出しには反映されない
// (ローカルバインディング参照のため)。そのためbuildRankingSnapshotが依存する
// prisma/queryGiftsの側をモックし、呼び出し回数はqueryGiftsのモック呼び出し回数で数える。
const findUniqueMock = vi.fn(async (_args: unknown) => ({ id: "room_1" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tiktokRoom: {
      findUnique: (args: unknown) => findUniqueMock(args),
    },
  },
}));

const queryGiftsMock = vi.fn(
  async (_roomId: string, _viewerStreamerId: string, _filter: unknown, _cursor: unknown) => ({
    users: [],
    total: { giftCount: 0, totalDiamonds: 0 },
  })
);
vi.mock("@/lib/gift-analytics", () => ({
  queryGifts: (roomId: string, viewerStreamerId: string, filter: unknown, cursor: unknown) =>
    queryGiftsMock(roomId, viewerStreamerId, filter, cursor),
}));

const { scheduleRankingSnapshotEmit, __resetChatRankingThrottleForTest } = await import("./chat-ranking");

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

let emitted: Emitted[];

function installIo(): void {
  (global as unknown as { __io: unknown }).__io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
}

function removeIo(): void {
  delete (global as unknown as { __io?: unknown }).__io;
}

beforeEach(() => {
  emitted = [];
  queryGiftsMock.mockClear(); findUniqueMock.mockClear();
  __resetChatFeedStateForTest();
  __resetVersionStoreForTest();
  __resetChatRankingThrottleForTest();
  vi.useFakeTimers();
  installIo();
});

afterEach(() => {
  __resetChatRankingThrottleForTest();
  vi.useRealTimers();
});

describe("scheduleRankingSnapshotEmit — throttle", () => {
  it("同一roomIdへ連続で複数回スケジュールしても、throttle window内ではbuildRankingSnapshotは1回だけ呼ばれる", async () => {
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);

    await vi.advanceTimersByTimeAsync(500);

    expect(queryGiftsMock).toHaveBeenCalledTimes(1);
  });

  it("同一roomIdを複数streamerIdが共有していても、buildRankingSnapshotの呼び出し回数はstreamerId数によらず1回", async () => {
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    scheduleRankingSnapshotEmit("room_1", ["streamer_2"]);
    scheduleRankingSnapshotEmit("room_1", ["streamer_3"]);

    await vi.advanceTimersByTimeAsync(500);

    expect(queryGiftsMock).toHaveBeenCalledTimes(1);
    const events = emitted.filter((e) => e.event === "chat:ranking:snapshot");
    expect(events.map((e) => e.room).sort()).toEqual(["chat:streamer_1", "chat:streamer_2", "chat:streamer_3"]);
  });

  it("throttle windowを跨げばbuildRankingSnapshotは再度呼ばれる", async () => {
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(queryGiftsMock).toHaveBeenCalledTimes(1);

    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(queryGiftsMock).toHaveBeenCalledTimes(2);
  });

  it("異なるroomIdは互いに独立してbuildRankingSnapshotを呼ぶ", async () => {
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    scheduleRankingSnapshotEmit("room_2", ["streamer_2"]);

    await vi.advanceTimersByTimeAsync(500);

    expect(queryGiftsMock).toHaveBeenCalledTimes(2);
    expect(queryGiftsMock.mock.calls.map((c) => c[0]).sort()).toEqual(["room_1", "room_2"]);
  });

  it("streamerIdsが空配列なら何もスケジュールしない", async () => {
    scheduleRankingSnapshotEmit("room_1", []);
    await vi.advanceTimersByTimeAsync(500);
    expect(queryGiftsMock).not.toHaveBeenCalled();
  });

  it("io未初期化でもbuildRankingSnapshot自体は呼ばれるが、emitはされない(drop許容)", async () => {
    removeIo();
    scheduleRankingSnapshotEmit("room_1", ["streamer_1"]);
    await vi.advanceTimersByTimeAsync(500);

    expect(queryGiftsMock).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(0);
  });
});

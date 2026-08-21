import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  emitChatComment,
  emitChatFollow,
  emitChatGift,
  __resetChatFeedStateForTest,
  type ChatCommentPayload,
  type ChatGiftInput,
  type ChatGiftPayload,
} from "./chat-feed";

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

function makeComment(overrides: Partial<ChatCommentPayload> = {}): ChatCommentPayload {
  return {
    streamerId: "streamer_1",
    uniqueId: "user_x",
    nickname: "ユーザーX",
    profilePictureUrl: null,
    comment: "こんにちは",
    receivedAt: new Date().toISOString(),
    msgId: "msg_1",
    ...overrides,
  };
}

function makeGift(overrides: Partial<ChatGiftInput> = {}): ChatGiftInput {
  return {
    streamerId: "streamer_1",
    uniqueId: "user_x",
    nickname: "ユーザーX",
    profilePictureUrl: null,
    giftName: "rose",
    giftId: "5655",
    diamondCount: 1,
    repeatCount: 1,
    isCombo: true,
    repeatEnd: false,
    groupId: "group_1",
    orderId: null,
    msgId: "gift_msg_1",
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function giftPayloads(): ChatGiftPayload[] {
  return emitted.filter((e) => e.event === "chat:gift").map((e) => e.payload as ChatGiftPayload);
}

beforeEach(() => {
  emitted = [];
  __resetChatFeedStateForTest();
  installIo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("emitChatComment", () => {
  it("同じstreamerId+msgIdの再配信は2回目以降スキップする(デプロイ時の新旧Worker並走で同一メッセージが二重転送されるケース対策)", async () => {
    const payload = makeComment();
    await emitChatComment(payload);
    await emitChatComment(payload);
    expect(emitted).toHaveLength(1);
  });

  it("msgIdが異なれば両方配信する", async () => {
    await emitChatComment(makeComment({ msgId: "msg_a" }));
    await emitChatComment(makeComment({ msgId: "msg_b" }));
    expect(emitted).toHaveLength(2);
  });

  it("msgIdがnullの場合はdedupせずそのまま配信する(欠損時に握りつぶさない)", async () => {
    await emitChatComment(makeComment({ msgId: null }));
    await emitChatComment(makeComment({ msgId: null }));
    expect(emitted).toHaveLength(2);
  });

  it("streamerIdが異なれば同じmsgIdでも両方配信する", async () => {
    await emitChatComment(makeComment({ streamerId: "a", msgId: "shared" }));
    await emitChatComment(makeComment({ streamerId: "b", msgId: "shared" }));
    expect(emitted).toHaveLength(2);
  });
});

describe("dedupのnamespace分離", () => {
  it("comment/follow/giftで同じID文字列を使っても互いにスキップさせない", async () => {
    const shared = "same_id";
    await emitChatComment(makeComment({ msgId: shared }));
    await emitChatFollow({
      streamerId: "streamer_1",
      uniqueId: "u",
      nickname: "n",
      profilePictureUrl: null,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      msgId: shared,
    });
    await emitChatGift(makeGift({ isCombo: false, orderId: shared, groupId: null }));

    expect(emitted.map((e) => e.event)).toEqual(["chat:comment", "chat:follow", "chat:gift"]);
  });
});

describe("emitChatGift — groupIdのあるコンボ", () => {
  it("1→2→5→5(repeatEnd) でdeltaが1,1,3になり最後のtickは配信しない", async () => {
    await emitChatGift(makeGift({ repeatCount: 1 }));
    await emitChatGift(makeGift({ repeatCount: 2 }));
    await emitChatGift(makeGift({ repeatCount: 5 }));
    await emitChatGift(makeGift({ repeatCount: 5, repeatEnd: true }));

    expect(giftPayloads().map((p) => p.delta)).toEqual([1, 1, 3]);
  });

  it("同一tickの重複は配信しない", async () => {
    await emitChatGift(makeGift({ repeatCount: 3 }));
    await emitChatGift(makeGift({ repeatCount: 3 }));
    expect(giftPayloads()).toHaveLength(1);
  });

  it("逆順到着(小さいrepeatCountが後から届く)は配信しない", async () => {
    await emitChatGift(makeGift({ repeatCount: 5 }));
    await emitChatGift(makeGift({ repeatCount: 2 }));
    expect(giftPayloads().map((p) => p.delta)).toEqual([1]);
  });

  it("新旧Workerが同じコンボへ別々の累計を送っても単一の系列に正規化される", async () => {
    // 新Workerは古い累計(DB復元)から、旧Workerは自前のメモリから送ってくる。
    await emitChatGift(makeGift({ repeatCount: 1 })); // 旧Worker
    await emitChatGift(makeGift({ repeatCount: 1 })); // 新Worker(重複) → 捨てる
    await emitChatGift(makeGift({ repeatCount: 3 })); // 旧Worker
    await emitChatGift(makeGift({ repeatCount: 2 })); // 新Worker(遅れ) → 捨てる
    await emitChatGift(makeGift({ repeatCount: 4 })); // 旧Worker

    // 累計は 1 → 3 → 4。deltaの合計が最終累計と一致する。
    const deltas = giftPayloads().map((p) => p.delta);
    expect(deltas).toEqual([1, 2, 1]);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("repeatEnd後により小さい遅延tickが届いても再発火しない", async () => {
    await emitChatGift(makeGift({ repeatCount: 5, repeatEnd: true }));
    emitted = [];
    await emitChatGift(makeGift({ repeatCount: 3 }));
    expect(giftPayloads()).toHaveLength(0);
  });

  it("repeatEnd後により大きい遅延tickが届いても再発火しない(maxRepeat保持だけでは防げないケース)", async () => {
    await emitChatGift(makeGift({ repeatCount: 5, repeatEnd: true }));
    emitted = [];
    await emitChatGift(makeGift({ repeatCount: 99 }));
    expect(giftPayloads()).toHaveLength(0);
  });

  it("別streamerの同じgroupIdは互いに影響しない", async () => {
    await emitChatGift(makeGift({ streamerId: "a", repeatCount: 4 }));
    await emitChatGift(makeGift({ streamerId: "b", repeatCount: 4 }));

    expect(giftPayloads().map((p) => p.streamerId)).toEqual(["a", "b"]);
    expect(emitted.map((e) => e.room)).toEqual(["chat:a", "chat:b"]);
  });
});

describe("emitChatGift — コールドスタート(Web側の状態消失)", () => {
  it("状態が無いところへ途中tick(repeatCount=8)が来たらdelta=1に切り詰めbaselineResetを立てる", async () => {
    await emitChatGift(makeGift({ repeatCount: 8 }));

    const [payload] = giftPayloads();
    expect(payload.delta).toBe(1);
    expect(payload.baselineReset).toBe(true);
    expect(payload.repeatCount).toBe(8);
  });

  it("コールドスタート後は通常どおり増分でdeltaを出す", async () => {
    await emitChatGift(makeGift({ repeatCount: 8 }));
    await emitChatGift(makeGift({ repeatCount: 11 }));

    const payloads = giftPayloads();
    expect(payloads.map((p) => p.delta)).toEqual([1, 3]);
    expect(payloads.map((p) => p.baselineReset)).toEqual([true, false]);
  });

  it("repeatCount=1の正常な開始ではbaselineResetを立てない", async () => {
    await emitChatGift(makeGift({ repeatCount: 1 }));
    expect(giftPayloads()[0].baselineReset).toBe(false);
  });

  it("TTL掃除でエントリが消えた後も、累計値まで跳ねずdelta=1に留まる", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:00:00Z"));
    await emitChatGift(makeGift({ repeatCount: 3 }));
    emitted = [];

    // スライディングTTL(10分)を超えて放置する。
    vi.setSystemTime(new Date("2026-08-21T00:11:00Z"));
    await emitChatGift(makeGift({ repeatCount: 50 }));

    const [payload] = giftPayloads();
    expect(payload.delta).toBe(1);
    expect(payload.baselineReset).toBe(true);
  });

  it("TTL未満の間隔ならエントリは維持される(生成時起点で消さない)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:00:00Z"));
    await emitChatGift(makeGift({ repeatCount: 3 }));
    emitted = [];

    // 9分後 → まだ生きている。
    vi.setSystemTime(new Date("2026-08-21T00:09:00Z"));
    await emitChatGift(makeGift({ repeatCount: 5 }));

    const [payload] = giftPayloads();
    expect(payload.delta).toBe(2);
    expect(payload.baselineReset).toBe(false);
  });
});

describe("emitChatGift — groupIdの無いコンボ", () => {
  const noGroup = { isCombo: true, groupId: null, orderId: null };

  it("途中tickは配信せず、repeatEndのtickだけをdelta=1で1回配信する", async () => {
    await emitChatGift(makeGift({ ...noGroup, repeatCount: 1 }));
    await emitChatGift(makeGift({ ...noGroup, repeatCount: 4 }));
    await emitChatGift(makeGift({ ...noGroup, repeatCount: 7, repeatEnd: true }));

    const payloads = giftPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].delta).toBe(1);
    expect(payloads[0].comboId).toBeNull();
    expect(payloads[0].totalCoins).toBe(7);
  });

  it("新旧Workerが同じ最終tickを送ってもmsgIdで1回に落とす", async () => {
    const final = { ...noGroup, repeatCount: 7, repeatEnd: true, msgId: "final_msg" };
    await emitChatGift(makeGift(final));
    await emitChatGift(makeGift(final));
    expect(giftPayloads()).toHaveLength(1);
  });

  it("同一ユーザー・同一ギフトの連続する別コンボが互いを打ち消さない", async () => {
    await emitChatGift(makeGift({ ...noGroup, repeatCount: 3, repeatEnd: true, msgId: "combo_a_final" }));
    await emitChatGift(makeGift({ ...noGroup, repeatCount: 3, repeatEnd: true, msgId: "combo_b_final" }));
    expect(giftPayloads()).toHaveLength(2);
  });
});

describe("emitChatGift — 非コンボ", () => {
  it("orderIdでdedupし、repeatCountに関係なくdelta=1で1回だけ配信する", async () => {
    const gift = { isCombo: false, groupId: null, orderId: "order_1", repeatCount: 5, diamondCount: 10 };
    await emitChatGift(makeGift(gift));
    await emitChatGift(makeGift(gift));

    const payloads = giftPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].delta).toBe(1);
    expect(payloads[0].totalCoins).toBe(50);
  });

  it("orderIdが無ければgroupIdでdedupする", async () => {
    const gift = { isCombo: false, orderId: null, groupId: "fallback_group" };
    await emitChatGift(makeGift(gift));
    await emitChatGift(makeGift(gift));
    expect(giftPayloads()).toHaveLength(1);
  });

  it("orderId/groupIdが両方無ければdedupせず配信する(ダイヤを取りこぼさない)", async () => {
    const gift = { isCombo: false, orderId: null, groupId: null };
    await emitChatGift(makeGift(gift));
    await emitChatGift(makeGift(gift));
    expect(giftPayloads()).toHaveLength(2);
  });

  it("コンボと非コンボが同じ文字列をIDに使っても衝突しない", async () => {
    await emitChatGift(makeGift({ isCombo: true, groupId: "shared_id", repeatCount: 2 }));
    await emitChatGift(makeGift({ isCombo: false, groupId: "shared_id", orderId: null }));
    expect(giftPayloads()).toHaveLength(2);
  });
});

describe("socket.ioサーバー未初期化時", () => {
  it("comment/follow/giftいずれもfalseを返し、何も配信しない", async () => {
    removeIo();
    expect(await emitChatComment(makeComment())).toBe(false);
    expect(await emitChatGift(makeGift())).toBe(false);
    expect(
      await emitChatFollow({
        streamerId: "streamer_1",
        uniqueId: "u",
        nickname: "n",
        profilePictureUrl: null,
        occurredAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        msgId: "f1",
      })
    ).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it("状態を進めないので、再送されたtickを取りこぼさない", async () => {
    removeIo();
    await emitChatGift(makeGift({ repeatCount: 3 }));
    await emitChatComment(makeComment({ msgId: "m1" }));

    installIo();
    await emitChatGift(makeGift({ repeatCount: 3 }));
    await emitChatComment(makeComment({ msgId: "m1" }));

    expect(giftPayloads()).toHaveLength(1);
    expect(emitted.filter((e) => e.event === "chat:comment")).toHaveLength(1);
  });
});

describe("emitChatFollow", () => {
  function follow(msgId: string | null) {
    return {
      streamerId: "streamer_1",
      uniqueId: "follower",
      nickname: "フォロワー",
      profilePictureUrl: null,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      msgId,
    };
  }

  it("同じmsgIdの再送はスキップする", async () => {
    await emitChatFollow(follow("f1"));
    await emitChatFollow(follow("f1"));
    expect(emitted).toHaveLength(1);
  });

  it("msgIdがnullならdedupせず配信する", async () => {
    await emitChatFollow(follow(null));
    await emitChatFollow(follow(null));
    expect(emitted).toHaveLength(2);
  });

  it("schemaVersionを付与してchat:followとして配信する", async () => {
    await emitChatFollow(follow("f2"));
    expect(emitted[0].event).toBe("chat:follow");
    expect(emitted[0].room).toBe("chat:streamer_1");
    expect((emitted[0].payload as { schemaVersion: number }).schemaVersion).toBe(1);
  });
});

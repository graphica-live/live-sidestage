import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fixtures from "./__fixtures__/chat-events.json";
import {
  emitChatComment,
  emitChatFollow,
  emitChatGift,
  __resetChatFeedStateForTest,
} from "./chat-feed";

/**
 * `chat:*` の配信ペイロード契約テスト。
 *
 * 同じ fixture を Dart 側(live-sidestage-mobile/test/chat_event_contract_test.dart)からも読む。
 * サーバーがフィールドを増減させると、ここか Dart 側のどちらかが落ちる。
 * fixture の値そのものではなく **キー集合** を突き合わせている。値の妥当性は
 * chat-feed.test.ts が見ており、ここで重複させると意味が薄い。
 */

interface EmittedEvent {
  room: string;
  event: string;
  payload: Record<string, unknown>;
}

const emitted: EmittedEvent[] = [];

const g = globalThis as unknown as { __io?: unknown };

beforeEach(() => {
  emitted.length = 0;
  __resetChatFeedStateForTest();
  g.__io = {
    to(room: string) {
      return {
        emit(event: string, payload: Record<string, unknown>) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
});

afterEach(() => {
  delete g.__io;
});

function keysOf(value: object): string[] {
  return Object.keys(value)
    .filter((k) => !k.startsWith("_"))
    .sort();
}

describe("chat:* ペイロード契約", () => {
  it("chat:gift のキー集合が fixture と一致する(コンボ)", async () => {
    const fixture = fixtures.gift;
    const ok = await emitChatGift({
      streamerId: fixture.streamerId,
      uniqueId: fixture.uniqueId,
      nickname: fixture.nickname,
      profilePictureUrl: fixture.profilePictureUrl,
      giftName: fixture.giftName,
      giftId: fixture.giftId,
      diamondCount: fixture.diamondCount,
      repeatCount: fixture.repeatCount,
      isCombo: fixture.isCombo,
      repeatEnd: fixture.repeatEnd,
      groupId: fixture.comboId,
      orderId: null,
      msgId: null,
      occurredAt: fixture.occurredAt,
      receivedAt: fixture.receivedAt,
    });

    expect(ok).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("chat:gift");
    expect(emitted[0].room).toBe(`chat:${fixture.streamerId}`);
    expect(keysOf(emitted[0].payload)).toEqual(keysOf(fixture));
  });

  it("chat:gift のキー集合が fixture と一致する(非コンボ)", async () => {
    const fixture = fixtures.giftWithoutCombo;
    await emitChatGift({
      streamerId: fixture.streamerId,
      uniqueId: fixture.uniqueId,
      nickname: fixture.nickname,
      profilePictureUrl: fixture.profilePictureUrl,
      giftName: fixture.giftName,
      giftId: fixture.giftId,
      diamondCount: fixture.diamondCount,
      repeatCount: fixture.repeatCount,
      isCombo: fixture.isCombo,
      repeatEnd: fixture.repeatEnd,
      groupId: null,
      orderId: "order-1",
      msgId: null,
      occurredAt: fixture.occurredAt,
      receivedAt: fixture.receivedAt,
    });

    expect(emitted).toHaveLength(1);
    expect(keysOf(emitted[0].payload)).toEqual(keysOf(fixture));
    // 非コンボは comboId が null になる。Dart 側はこれを「サーバーで dedup 済みの
    // 単発」と解釈し、コンボ抑止の LRU へ入れない。
    expect(emitted[0].payload.comboId).toBeNull();
  });

  it("chat:follow のキー集合が fixture と一致する", async () => {
    const fixture = fixtures.follow;
    await emitChatFollow({
      streamerId: fixture.streamerId,
      uniqueId: fixture.uniqueId,
      nickname: fixture.nickname,
      profilePictureUrl: fixture.profilePictureUrl,
      occurredAt: fixture.occurredAt,
      receivedAt: fixture.receivedAt,
      msgId: fixture.msgId,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("chat:follow");
    expect(keysOf(emitted[0].payload)).toEqual(keysOf(fixture));
  });

  it("chat:comment のキー集合が fixture と一致する(schemaVersion を持たない既存形式)", async () => {
    const fixture = fixtures.comment;
    await emitChatComment({ ...fixture });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("chat:comment");
    expect(keysOf(emitted[0].payload)).toEqual(keysOf(fixture));
    expect(emitted[0].payload.schemaVersion).toBeUndefined();
  });
});

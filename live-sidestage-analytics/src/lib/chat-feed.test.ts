import { describe, it, expect, beforeEach } from "vitest";
import { emitChatComment, type ChatCommentPayload } from "./chat-feed";

function makePayload(overrides: Partial<ChatCommentPayload> = {}): ChatCommentPayload {
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

describe("emitChatComment", () => {
  let emitted: Array<{ room: string; payload: unknown }>;

  beforeEach(() => {
    emitted = [];
    (global as unknown as { __io: unknown }).__io = {
      to(room: string) {
        return {
          emit(_event: string, payload: unknown) {
            emitted.push({ room, payload });
          },
        };
      },
    };
  });

  // dedup stateはchat-feed.ts内部でglobal(モジュール再読込を跨いで生存)に保持されるため、
  // テスト間の汚染を避けるべく各itで専用のstreamerIdを使う。
  it("同じstreamerId+msgIdの再配信は2回目以降スキップする(デプロイ時の新旧Worker並走で同一メッセージが二重転送されるケース対策)", async () => {
    const payload = makePayload({ streamerId: "streamer_dup" });
    await emitChatComment(payload);
    await emitChatComment(payload);
    expect(emitted).toHaveLength(1);
  });

  it("msgIdが異なれば両方配信する", async () => {
    await emitChatComment(makePayload({ streamerId: "streamer_diff_msgid", msgId: "msg_a" }));
    await emitChatComment(makePayload({ streamerId: "streamer_diff_msgid", msgId: "msg_b" }));
    expect(emitted).toHaveLength(2);
  });

  it("msgIdがnullの場合はdedupせずそのまま配信する(欠損時に握りつぶさない)", async () => {
    await emitChatComment(makePayload({ streamerId: "streamer_null_msgid", msgId: null }));
    await emitChatComment(makePayload({ streamerId: "streamer_null_msgid", msgId: null }));
    expect(emitted).toHaveLength(2);
  });

  it("streamerIdが異なれば同じmsgIdでも両方配信する", async () => {
    await emitChatComment(makePayload({ streamerId: "streamer_diff_a", msgId: "msg_shared" }));
    await emitChatComment(makePayload({ streamerId: "streamer_diff_b", msgId: "msg_shared" }));
    expect(emitted).toHaveLength(2);
  });
});

// 内部APIのコメント受け口。**新旧2つの形を同時に受け付ける**ことが仕様の核心で、
// デプロイ中(Web先行・Worker後追い)に旧Workerの単数形を落とすとコメントが全断する。
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/chat-feed", () => ({
  emitChatComment: vi.fn().mockResolvedValue(true),
  emitChatBattle: vi.fn().mockResolvedValue(true),
  emitChatFollow: vi.fn().mockResolvedValue(true),
  emitChatGift: vi.fn().mockResolvedValue(true),
  emitChatListener: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/tiktok-listener", () => ({
  appendGiftLog: vi.fn(),
}));

vi.mock("@/lib/overlay", () => ({
  emitGiftDrivenOverlayUpdates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/overlay/like.server", () => ({
  applyLikeEventInProcess: vi.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from "next/server";
import { emitChatComment } from "@/lib/chat-feed";
import { POST } from "./route";

const SECRET = "test-internal-secret";

function post(body: unknown, secret: string = SECRET) {
  return new NextRequest("http://web.internal.test/api/internal/gift-event", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(body),
  });
}

const comment = {
  uniqueId: "listener_a",
  nickname: "リスナーA",
  profilePictureUrl: null,
  comment: "こんばんは",
  receivedAt: new Date().toISOString(),
  msgId: "7676639475879312345",
};

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = SECRET;
  vi.mocked(emitChatComment).mockClear();
  vi.mocked(emitChatComment).mockResolvedValue(true);
});

describe("POST /api/internal/gift-event — chatCommentEvent(まとめ形)", () => {
  it("streamerIdsの全員へ、それぞれのstreamerIdを付けて配信する", async () => {
    const res = await POST(post({ streamerIds: ["s1", "s2", "s3"], chatCommentEvent: comment }));

    expect(res.status).toBe(200);
    expect(emitChatComment).toHaveBeenCalledTimes(3);
    expect(vi.mocked(emitChatComment).mock.calls.map(([arg]) => arg.streamerId)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(vi.mocked(emitChatComment).mock.calls[0][0]).toMatchObject({
      streamerId: "s1",
      comment: "こんばんは",
      msgId: comment.msgId,
    });
  });

  it("streamerIdsが無ければ400。配信はしない", async () => {
    const res = await POST(post({ chatCommentEvent: comment }));

    expect(res.status).toBe(400);
    expect(emitChatComment).not.toHaveBeenCalled();
  });

  it("streamerIdsが空配列なら400。配信はしない", async () => {
    const res = await POST(post({ streamerIds: [], chatCommentEvent: comment }));

    expect(res.status).toBe(400);
    expect(emitChatComment).not.toHaveBeenCalled();
  });

  it("socket.ioが未初期化なら503を返す(Workerが再送の判断をできるようにするため)", async () => {
    vi.mocked(emitChatComment).mockResolvedValue(false);

    const res = await POST(post({ streamerIds: ["s1"], chatCommentEvent: comment }));

    expect(res.status).toBe(503);
  });

  it("secretが違えば401。配信はしない", async () => {
    const res = await POST(post({ streamerIds: ["s1"], chatCommentEvent: comment }, "wrong"));

    expect(res.status).toBe(401);
    expect(emitChatComment).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/gift-event — chatEvent(旧Workerの単数形)", () => {
  it("streamerId込みの単数形を今も受け付ける — デプロイ中に旧Workerが送ってくるため", async () => {
    const res = await POST(post({ chatEvent: { streamerId: "s9", ...comment } }));

    expect(res.status).toBe(200);
    expect(emitChatComment).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitChatComment).mock.calls[0][0]).toMatchObject({ streamerId: "s9" });
  });
});

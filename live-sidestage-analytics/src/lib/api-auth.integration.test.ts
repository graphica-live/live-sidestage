// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **BIO認証(Streamer.verified)を前提にしないことの回帰固定。**
// かつて resolveStreamerByApiKey() は `!streamer?.verified` で弾いており、TikEffect連携の
// x-api-key API だけが未認証ユーザーへ閉じていた。BIO認証をどの機能の前提にもしない方針に
// 変えたので、verified の値によらずキーの一致だけで通ることを固定する。
import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStreamerByApiKey } from "./api-auth";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const roomIds: string[] = [];

async function makeStreamer(verified: boolean) {
  const user = await prisma.user.create({
    data: { email: `itest-apiauth-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  userIds.push(user.id);

  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: `itestapiauth${Math.random().toString(36).slice(2, 8)}`.toLowerCase() },
    select: { id: true },
  });
  roomIds.push(room.id);

  const apiKey = `itest-key-${suffix()}`;
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: `itest-s-${suffix()}`,
      roomId: room.id,
      verificationCode: `itest-${suffix()}`,
      apiKey,
      verified,
      verifiedAt: verified ? new Date() : null,
    },
    select: { id: true },
  });

  return { streamerId: streamer.id, roomId: room.id, apiKey };
}

function requestWithKey(apiKey: string | null) {
  const headers = new Headers();
  if (apiKey !== null) headers.set("x-api-key", apiKey);
  return new NextRequest("https://example.test/api/analytics/monthly-contributors", { headers });
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("resolveStreamerByApiKey", () => {
  it("verified:false の Streamer も通す(BIO認証を前提にしない)", async () => {
    const s = await makeStreamer(false);

    const resolved = await resolveStreamerByApiKey(requestWithKey(s.apiKey));

    expect(resolved).toEqual({ id: s.streamerId, roomId: s.roomId });
  });

  it("verified:true でも同じく通る", async () => {
    const s = await makeStreamer(true);

    const resolved = await resolveStreamerByApiKey(requestWithKey(s.apiKey));

    expect(resolved).toEqual({ id: s.streamerId, roomId: s.roomId });
  });

  it("キーが一致しなければ通さない", async () => {
    await makeStreamer(true);

    expect(await resolveStreamerByApiKey(requestWithKey("itest-key-does-not-exist"))).toBeNull();
  });

  it("キーが無ければ通さない", async () => {
    expect(await resolveStreamerByApiKey(requestWithKey(null))).toBeNull();
  });
});

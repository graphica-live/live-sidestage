// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { POST } from "./route";

const TIKTOK_ID = "itest_mobile_gift_share";

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let token: string;
let noRoomToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-gift-share-secret";

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({ data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) } });
  roomId = room.id;

  const user = await prisma.principal.create({
    data: { email: `itest-mobile-gift-share-${Date.now()}@local.test` },
  });
  principalId = user.id;
  await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  token = signMobileToken({ principalId });

  const noRoom = await prisma.principal.create({
    data: { email: `itest-mobile-gift-share-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId });
});

afterAll(async () => {
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {}); // cascades -> ContributionShareToken
  await prisma.$disconnect();
});

function request(bearer: string | undefined, body: unknown) {
  return new NextRequest("http://localhost/api/mobile/analytics/gifts/share", {
    method: "POST",
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/analytics/gifts/share", () => {
  it("トークンが無ければ401(share tokenを発行しない)", async () => {
    const res = await POST(request(undefined, { period: "day", date: "2026-09-01" }));
    expect(res.status).toBe(401);

    const rows = await prisma.contributionShareToken.findMany({ where: { roomId } });
    expect(rows).toHaveLength(0);
  });

  it("room未接続なら404", async () => {
    const res = await POST(request(noRoomToken, { period: "day", date: "2026-09-01" }));
    expect(res.status).toBe(404);
  });

  it("period が不正なら400(トークンを発行しない)", async () => {
    const res = await POST(request(token, { period: "century" }));
    expect(res.status).toBe(400);
  });

  it("正しいroomでは200、/c/配下のURLを返す", async () => {
    const res = await POST(request(token, { period: "day", date: "2026-09-01" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.url).toBe("string");
    expect(body.url).toMatch(/\/c\/[0-9a-f]{48}$/);
  });

  it("既発行tokenは再利用する(同一期間定義の2回目も同じURL)", async () => {
    const res1 = await POST(request(token, { period: "week", date: "2026-09-01" }));
    const body1 = await res1.json();
    const res2 = await POST(request(token, { period: "week", date: "2026-09-01" }));
    const body2 = await res2.json();
    expect(body2.url).toBe(body1.url);
  });
});
